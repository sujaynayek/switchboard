import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config } from '../config/env.js';
import { secretsMatch } from '../utils/secrets.js';
import { isRecord, nonemptyString } from '../utils/validation.js';

const { issuer, clientId, clientSecret, redirectUri } = config.oidc;
let discovery;

async function loadDiscovery() {
  const response = await fetch(issuer.replace(/\/$/, '') + '/.well-known/openid-configuration', {
    redirect: 'error', signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) throw new Error('OIDC discovery failed');
  const metadata = await response.json();
  if (metadata.issuer !== issuer) throw new Error('OIDC discovery issuer mismatch');

  // The supplied provider serves all endpoints on its configured issuer origin.
  for (const field of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
    if (!nonemptyString(metadata[field]) || new URL(metadata[field]).origin !== new URL(issuer).origin) {
      throw new Error('Unexpected OIDC endpoint');
    }
  }
  return {
    authorizationEndpoint: metadata.authorization_endpoint,
    tokenEndpoint: metadata.token_endpoint,
    jwks: createRemoteJWKSet(new URL(metadata.jwks_uri), { timeoutDuration: 4000, cooldownDuration: 0 }),
  };
}

function provider() {
  discovery ??= loadDiscovery().catch((error) => {
    discovery = undefined;
    throw error;
  });
  return discovery;
}

export async function authorizationUrl({ state, challenge, nonce }) {
  const { authorizationEndpoint } = await provider();
  const url = new URL(authorizationEndpoint);
  url.search = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid',
    code_challenge: challenge, code_challenge_method: 'S256', state, nonce,
  });
  return url.toString();
}

export async function exchangeCode(code, { verifier, nonce }) {
  const { tokenEndpoint, jwks } = await provider();
  const response = await fetch(tokenEndpoint, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(4000),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code, redirect_uri: redirectUri,
      client_id: clientId, client_secret: clientSecret, code_verifier: verifier,
    }),
  });
  if (response.status === 400 || response.status === 401) return null;
  if (!response.ok) throw new Error('OIDC token exchange failed');

  const token = await response.json();
  if (!nonemptyString(token?.id_token)) return null;
  let claims;
  try {
    ({ payload: claims } = await jwtVerify(token.id_token, jwks, {
      algorithms: ['RS256'], issuer, audience: clientId, maxTokenAge: '1h',
      requiredClaims: ['sub', 'exp', 'iat', 'nonce'],
    }));
  } catch (error) {
    if (error.code === 'ERR_JWKS_TIMEOUT' || error instanceof TypeError) throw error;
    return null;
  }
  if (!nonemptyString(claims.sub) || !secretsMatch(claims.nonce, nonce) ||
      (claims.azp !== undefined && claims.azp !== clientId) ||
      (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== clientId) ||
      !Array.isArray(claims.workspaces)) return null;

  const memberships = new Map();
  for (const membership of claims.workspaces) {
    if (!isRecord(membership) || !nonemptyString(membership.id) ||
        !['admin', 'agent'].includes(membership.role) || memberships.has(membership.id)) return null;
    memberships.set(membership.id, membership.role);
  }
  const ttl = Math.min(3600, Math.floor(claims.exp - Date.now() / 1000));
  if (ttl <= 0) return null;
  return {
    ttl,
    identity: { sub: claims.sub, workspaces: [...memberships].map(([id, role]) => ({ id, role })) },
  };
}
