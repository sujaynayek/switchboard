import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

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
  const provider = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const { client_ref: ref } = JSON.parse(Buffer.concat(chunks));
    const key = req.headers['idempotency-key'];
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
  } finally {
    await Promise.all(children.map(kill));
    provider.closeAllConnections();
    await new Promise((resolve) => provider.close(resolve));
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
