import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

const root = fileURLToPath(new URL('../../', import.meta.url));
const mongoUrl = new URL(process.env.SWITCHBOARD_TEST_MONGO_URL ?? 'mongodb://localhost:27017');
mongoUrl.pathname = '/switchboard_test_' + randomUUID().replaceAll('-', '');
const workspace = 'ws_acme';
const contact = '+14155550101';
const secret = 'phase3-test-webhook';
const graderToken = 'phase3-test-grader';

async function until(check, label, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await sleep(50);
  }
  throw new Error('Timed out waiting for ' + label);
}

function signedHeaders(body, timestamp = Math.floor(Date.now() / 1000)) {
  const digest = createHmac('sha256', secret).update(timestamp + '.').update(body).digest('hex');
  return { 'x-pigeon-signature': 't=' + timestamp + ',v1=' + digest };
}

function pigeonEvent(id, type, data, overrides = {}) {
  return { id, type, workspace, occurred_at: new Date().toISOString(), data, ...overrides };
}

function webhook(base, body, headers = signedHeaders(body)) {
  return fetch(base + '/webhooks/pigeon', { method: 'POST', headers, body, signal: AbortSignal.timeout(5000) });
}

function grader(base, path, body) {
  return fetch(base + '/__grader/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-grader-token': graderToken, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
}

async function kill(instance) {
  if (instance.exitCode !== null || instance.signalCode !== null) return;
  const exited = once(instance, 'exit');
  instance.kill('SIGKILL');
  await exited;
}

test('Pigeon contract and crash recovery', { timeout: 60_000 }, async (t) => {
  const attempts = [];
  const accepted = new Map();
  const firstResponses = new Map();
  const children = [];
  let redirectsFollowed = 0;
  const codes = new Map();
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const otherKey = (await generateKeyPair('RS256')).privateKey;
  const jwk = { ...await exportJWK(publicKey), kid: 'test', alg: 'RS256' };
  let issuer;
  const idp = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/.well-known/openid-configuration') {
      return res.end(JSON.stringify({
        issuer, authorization_endpoint: issuer + '/authorize',
        token_endpoint: issuer + '/token', jwks_uri: issuer + '/jwks',
      }));
    }
    if (req.url === '/jwks') return res.end(JSON.stringify({ keys: [jwk] }));
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const form = new URLSearchParams(Buffer.concat(chunks).toString());
    const entry = codes.get(form.get('code'));
    const verifier = form.get('code_verifier') ?? '';
    if (!entry || createHash('sha256').update(verifier).digest('base64url') !== entry.challenge) {
      res.statusCode = 400;
      return res.end('{}');
    }
    const id_token = await new SignJWT(entry.claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'test' }).sign(entry.invalidSignature ? otherKey : privateKey);
    res.end(JSON.stringify({ id_token }));
  });
  idp.listen(0, '127.0.0.1');
  await once(idp, 'listening');
  issuer = 'http://127.0.0.1:' + idp.address().port;
  const provider = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const { client_ref: ref } = JSON.parse(Buffer.concat(chunks));
    const key = req.headers['idempotency-key'];
    if (req.url === '/redirected') {
      redirectsFollowed += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ id: 'redirected', status: 'accepted' }));
    }
    if (ref === 'redirect-test') {
      attempts.push({ ref, key });
      res.writeHead(307, { location: '/redirected' });
      return res.end();
    }
    attempts.push({ ref, key });
    if (!accepted.has(key)) {
      accepted.set(key, { id: 'pm_' + accepted.size, status: 'accepted' });
      firstResponses.set(ref, res);
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(accepted.get(key)));
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  Object.assign(process.env, {
    MONGO_URL: mongoUrl.toString(),
    REDIS_URL: process.env.SWITCHBOARD_TEST_REDIS_URL ?? 'redis://localhost:6379/15',
    PIGEON_URL: 'http://127.0.0.1:' + provider.address().port,
    PIGEON_WEBHOOK_SECRET: secret,
    GRADER_TOKEN: graderToken,
    OIDC_ISSUER: issuer,
    OIDC_CLIENT_ID: 'audit-client',
    OIDC_REDIRECT_URI: 'https://localhost:4000/auth/callback',
    WEB_ORIGIN: 'http://localhost:5173',
  });
  const { db, mongo, redis } = await import('../src/config/stores.js');
  const { currentGeneration, initializeModels, messages } = await import('../src/models/inbox.js');
  const { storeInbound } = await import('../src/services/inbox.js');
  const { advanceEventGeneration, publishEvent, readEvents } = await import('../src/services/event-stream.js');
  const { clearRateLimits, pauseWorkspace, takeToken } = await import('../src/services/rate-limit.js');

  async function start() {
    const instance = spawn(process.execPath, ['backend/src/index.js'], {
      cwd: root, env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(instance);
    let output = '';
    instance.stdout.on('data', (chunk) => { output += chunk; });
    instance.stderr.on('data', (chunk) => { output += chunk; });
    const port = await until(() => {
      assert.equal(instance.exitCode, null, output);
      return /Switchboard listening on (\d+)/.exec(output)?.[1];
    }, 'backend startup');
    return { instance, base: 'http://127.0.0.1:' + port };
  }

  try {
    await Promise.all([mongo.connect(), redis.connect()]);
    await initializeModels();
    const generation = await currentGeneration();
    await advanceEventGeneration(generation);

    await t.test('publishes an unflushed MongoDB event and deduplicates one already in the journal', async () => {
      for (const id of ['already-published', 'pending']) {
        await storeInbound({ id, workspace, occurredAt: new Date(),
          data: { from: contact, text: id, message_id: id } });
      }
      const existing = await messages.findOne({ providerId: 'already-published' });
      await publishEvent(workspace, generation, existing.outbox[0]);
      const servers = await Promise.all([start(), start()]);
      await until(async () => await messages.countDocuments({ 'outbox.0': { $exists: true } }) === 0, 'outbox drain');
      const events = await readEvents(workspace, 0);
      assert.deepEqual(events.map(({ message_id }) => message_id), ['already-published', 'pending']);
      assert.ok(events[0].seq < events[1].seq);
      await Promise.all(servers.map(({ instance }) => kill(instance)));
    });

    await t.test('applies the webhook response table to the signed raw request', async () => {
      const { base, instance } = await start();
      const malformed = Buffer.from('{');
      const payload = JSON.stringify(pigeonEvent('signed', 'message.inbound',
        { from: contact, text: 'signed bytes', message_id: 'signed-message' }));
      const raw = Buffer.from(' ' + payload + '\n');
      const now = Math.floor(Date.now() / 1000);
      const cases = [
        [raw, {}, 401],
        [raw, { 'x-pigeon-signature': 'invalid' }, 401],
        [raw, signedHeaders(payload), 401],
        [raw, signedHeaders(raw, now - 301), 401],
        [raw, signedHeaders(raw, now - 295), 204],
        [raw, signedHeaders(raw), 204],
        [malformed, signedHeaders(malformed), 400],
        [Buffer.from([0xff]), undefined, 400],
        [JSON.stringify(pigeonEvent('other', 'future.event', {})), undefined, 204],
        [JSON.stringify(pigeonEvent('tenant', 'message.inbound', {}, { workspace: 'unknown' })), undefined, 204],
        [JSON.stringify(pigeonEvent('unmatched', 'message.status',
          { message_id: 'unknown', client_ref: 'unknown', status: 'delivered' })), undefined, 204],
        [JSON.stringify(pigeonEvent('new-status', 'message.status',
          { message_id: 'unknown', client_ref: 'unknown', status: 'future' })), undefined, 204],
      ];
      for (const [body, headers, status] of cases) {
        assert.equal((await webhook(base, body, headers)).status, status, String(body));
      }
      const repeat = JSON.stringify(pigeonEvent('second-event', 'message.inbound',
        { from: contact, text: 'duplicate under a new event ID', message_id: 'signed-message' }));
      assert.equal((await webhook(base, repeat)).status, 204);
      assert.equal((await fetch(base + '/__grader/snapshot')).status, 401);
      const snapshot = await (await grader(base, 'snapshot')).json();
      assert.equal(snapshot.workspaces[workspace].contacts[contact].inbound.filter((id) => id === 'signed-message').length, 1);
      assert.deepEqual(snapshot.workspaces[workspace].outbound, {});
      await kill(instance);
    });

    await t.test('an overlapping shorter Retry-After cannot cut short an existing workspace cooldown', async () => {
      try {
        await pauseWorkspace(workspace, 2200);
        await pauseWorkspace(workspace, 200);
        assert.ok(await takeToken(workspace) > 1500, 'existing workspace cooldown was shortened');
        assert.equal(await takeToken('ws_globex'), 0, 'a cooldown affected another workspace');
      } finally {
        await clearRateLimits([workspace, 'ws_globex']);
      }
    });

    await t.test('replacement reuses the accepted reply key after SIGKILL and ignores late sent', async () => {
      const first = await start();
      const ref = 'accepted-before-crash';
      assert.equal((await grader(first.base, 'reply', { workspace, contact, text: 'recover me', client_ref: ref })).status, 202);
      await until(() => attempts.length === 1, 'first carrier acceptance');
      const crashedAt = Date.now();
      await kill(first.instance);
      const second = await start();
      await until(async () => {
        const snapshot = await (await grader(second.base, 'snapshot')).json();
        return snapshot.workspaces[workspace].outbound[ref] === 'sent';
      }, 'replacement completing abandoned work');
      assert.ok(Date.now() - crashedAt < 60_000);
      assert.deepEqual(attempts.map(({ ref: sentRef }) => sentRef), [ref, ref]);
      assert.ok(attempts[0].key);
      assert.equal(attempts[0].key, attempts[1].key);
      assert.equal(accepted.size, 1);
      const providerId = accepted.get(attempts[0].key).id;
      const wrongMessage = JSON.stringify(pigeonEvent('wrong-provider-id', 'message.status',
        { message_id: 'pm_other', client_ref: ref, status: 'failed' }));
      assert.equal((await webhook(second.base, wrongMessage)).status, 204);
      for (const status of ['delivered', 'sent']) {
        const body = JSON.stringify(pigeonEvent('status-' + status, 'message.status',
          { message_id: providerId, client_ref: ref, status }));
        assert.equal((await webhook(second.base, body)).status, 204);
      }
      const snapshot = await (await grader(second.base, 'snapshot')).json();
      assert.equal(snapshot.workspaces[workspace].outbound[ref], 'delivered');
      await until(async () => (await readEvents(workspace, 0)).some((frame) => frame.status === 'delivered'), 'terminal event');
      const frameStatuses = (await readEvents(workspace, 0)).filter(({ client_ref }) => client_ref === ref).map(({ status }) => status);
      assert.deepEqual(frameStatuses, ['queued', 'sent', 'delivered']);

      const earlyRef = 'delivered-before-http';
      assert.equal((await grader(second.base, 'reply', {
        workspace, contact, text: 'confirm with a webhook first', client_ref: earlyRef,
      })).status, 202);
      const pendingResponse = await until(() => firstResponses.get(earlyRef), 'second carrier acceptance');
      const earlyResult = accepted.get(attempts.find(({ ref: sentRef }) => sentRef === earlyRef).key);
      const earlyDelivery = JSON.stringify(pigeonEvent('early-delivery', 'message.status',
        { message_id: earlyResult.id, client_ref: earlyRef, status: 'delivered' }));
      assert.equal((await webhook(second.base, earlyDelivery)).status, 204);
      pendingResponse.writeHead(200, { 'content-type': 'application/json' });
      pendingResponse.end(JSON.stringify(earlyResult));
      await until(async () => (await readEvents(workspace, 0))
        .some((frame) => frame.client_ref === earlyRef && frame.status === 'delivered'), 'early delivery event');
      const updated = await (await grader(second.base, 'snapshot')).json();
      assert.equal(updated.workspaces[workspace].outbound[earlyRef], 'delivered');
      assert.deepEqual((await readEvents(workspace, 0)).filter(({ client_ref }) => client_ref === earlyRef)
        .map(({ status }) => status), ['queued', 'delivered']);
      await kill(second.instance);
    });

    await t.test('enforces grader access and reset while rejecting carrier redirects', async () => {
      const { instance, base } = await start();
      for (const [method, endpoint] of [
        ['GET', 'snapshot'], ['POST', 'reset'], ['POST', 'claim'], ['POST', 'reply'],
      ]) {
        for (const headers of [{}, { 'x-grader-token': 'incorrect' }]) {
          assert.equal((await fetch(base + '/__grader/' + endpoint, { method, headers })).status, 401);
        }
      }
      assert.equal((await grader(base, 'reply', { workspace: 'unknown', contact, text: 'hello', client_ref: 'x' })).status, 400);
      const claim = { workspace, contact: '+15550000001', agent: 'opaque-agent' };
      assert.equal((await grader(base, 'claim', claim)).status, 200);
      assert.equal((await grader(base, 'claim', claim)).status, 200);
      assert.equal((await grader(base, 'claim', { ...claim, agent: 'competitor' })).status, 409);
      const reply = { workspace, contact, text: 'redirect test', client_ref: 'redirect-test' };
      for (const response of await Promise.all([grader(base, 'reply', reply), grader(base, 'reply', reply)])) {
        assert.equal(response.status, 202);
      }
      await until(() => attempts.filter(({ ref }) => ref === reply.client_ref).length >= 2, 'redirect retry');
      assert.equal(redirectsFollowed, 0);
      assert.equal(await messages.countDocuments({ clientRef: reply.client_ref }), 1);
      const before = await (await grader(base, 'snapshot')).json();
      assert.deepEqual(before.workspaces[workspace].contacts[claim.contact], { inbound: [], assignee: claim.agent });
      assert.equal(before.workspaces[workspace].outbound[reply.client_ref], 'queued');
      assert.equal((await grader(base, 'reset', {})).status, 200);
      const empty = { contacts: {}, outbound: {} };
      assert.deepEqual(await (await grader(base, 'snapshot')).json(), { workspaces: { ws_acme: empty, ws_globex: empty } });
      assert.deepEqual(await readEvents(workspace, 0), []);
      await kill(instance);
    });

    await t.test('binds OIDC state, validates signed claims and scopes HTTP and WebSocket access', async () => {
      const { instance, base } = await start();
      async function signIn(overrides = {}, invalidSignature = false, checkReplay = false) {
        const login = await fetch(base + '/auth/login', { redirect: 'manual' });
        assert.equal(login.status, 302);
        const authorization = new URL(login.headers.get('location'));
        assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
        const state = authorization.searchParams.get('state');
        const cookie = login.headers.getSetCookie()[0].split(';')[0];
        const code = randomUUID();
        const now = Math.floor(Date.now() / 1000);
        codes.set(code, {
          challenge: authorization.searchParams.get('code_challenge'), invalidSignature,
          claims: {
            iss: issuer, aud: 'audit-client', sub: 'audit-agent', iat: now, exp: now + 300,
            nonce: authorization.searchParams.get('nonce'), workspaces: [{ id: workspace, role: 'agent' }],
            ...overrides,
          },
        });
        const url = base + '/auth/callback?' + new URLSearchParams({ code, state });
        if (checkReplay) {
          assert.equal((await fetch(url, { redirect: 'manual' })).status, 400);
          assert.equal((await fetch(url.replace(state, 'x'.repeat(43)), { headers: { cookie } })).status, 400);
        }
        const callback = await fetch(url, { headers: { cookie }, redirect: 'manual' });
        if (checkReplay) assert.equal((await fetch(url, { headers: { cookie }, redirect: 'manual' })).status, 400);
        return callback;
      }
      for (const overrides of [
        { iss: 'https://wrong.example' }, { aud: 'wrong' }, { exp: 1 }, { nonce: 'wrong' },
        { workspaces: [{ id: workspace, role: 'unknown' }] },
      ]) assert.equal((await signIn(overrides)).status, 401);
      assert.equal((await signIn({}, true)).status, 401);
      const callback = await signIn({}, false, true);
      assert.equal(callback.status, 303);
      const session = callback.headers.getSetCookie().find((value) => value.startsWith('switchboard_session='));
      for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax']) assert.ok(session.includes(flag));
      const cookie = session.split(';')[0];
      const get = (path) => fetch(base + path, { headers: { cookie } });
      assert.deepEqual(await (await get('/api/me')).json(), {
        sub: 'audit-agent', workspaces: [{ id: workspace, role: 'agent' }],
      });
      for (const suffix of ['', '/messages', '/claim', '/reply', '/close', '/reopen']) {
        const method = ['', '/messages'].includes(suffix) ? 'GET' : 'POST';
        const path = '/api/conversations/' + encodeURIComponent(contact) + suffix;
        assert.equal((await fetch(base + path + '?workspace=ws_globex', { method, headers: { cookie } })).status, 403);
      }
      const action = base + '/api/conversations/' + encodeURIComponent(contact) + '/claim?workspace=' + workspace;
      for (const headers of [{ origin: 'https://foreign.example' }, { 'sec-fetch-site': 'same-site' }]) {
        assert.equal((await fetch(action, { method: 'POST', headers: { cookie, ...headers } })).status, 403);
      }
      assert.equal((await grader(base, 'claim', { workspace, contact, agent: 'another-agent' })).status, 200);
      assert.equal((await fetch(action.replace('/claim?', '/close?'), {
        method: 'POST', headers: { cookie, origin: 'http://localhost:5173' },
      })).status, 403);
      const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws?workspace=' + workspace, {
        headers: { cookie, origin: 'https://foreign.example' },
      });
      const refused = await new Promise((resolve) => {
        ws.addEventListener('open', () => { ws.close(); resolve(false); }, { once: true });
        ws.addEventListener('error', () => resolve(true), { once: true });
      });
      assert.equal(refused, true);
      assert.equal((await fetch(base + '/auth/logout', { method: 'POST', headers: { cookie } })).status, 204);
      assert.equal((await get('/api/me')).status, 401);
      await kill(instance);
    });
  } finally {
    await Promise.all(children.map(kill));
    provider.closeAllConnections();
    idp.closeAllConnections();
    await Promise.all([provider, idp].map((server) => new Promise((resolve) => server.close(resolve))));
    try {
      await db.dropDatabase();
      const keys = await redis.keys('switchboard:' + db.databaseName + ':*');
      if (keys.length) await redis.unlink(...keys);
      await clearRateLimits([workspace, 'ws_globex']);
    } finally {
      redis.disconnect();
      await mongo.close();
    }
  }
});
