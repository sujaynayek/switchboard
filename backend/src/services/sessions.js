import { createHash, randomBytes } from 'node:crypto';
import { config } from '../config/env.js';
import { db, redis } from '../config/stores.js';

const prefix = 'switchboard:' + db.databaseName + ':auth:';
export const sessionCookie = 'switchboard_session';
export const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: new URL(config.oidc.redirectUri).protocol === 'https:',
  path: '/',
};

const randomToken = () => randomBytes(32).toString('base64url');
const digest = (value) => createHash('sha256').update(value).digest('base64url');
export const validToken = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
export const loginCookie = (state) => 'switchboard_login_' + state;

export function readCookie(header, name) {
  const values = (header ?? '').split(';').map((part) => part.trim())
    .filter((part) => part.startsWith(name + '='));
  if (values.length !== 1) return null;
  const value = values[0].slice(name.length + 1);
  return validToken(value) ? value : null;
}

const transactionKey = (state, binding) => prefix + 'login:' + state + ':' + digest(binding);
const sessionKey = (id) => prefix + 'session:' + digest(id);

export async function beginLogin() {
  const state = randomToken();
  const binding = randomToken();
  const verifier = randomToken();
  const nonce = randomToken();
  await redis.set(transactionKey(state, binding), JSON.stringify({ verifier, nonce }), 'EX', 600);
  return { state, binding, challenge: digest(verifier), nonce };
}

export async function consumeLogin(state, binding) {
  if (!validToken(state) || !binding) return null;
  const data = await redis.getdel(transactionKey(state, binding));
  return data ? JSON.parse(data) : null;
}

export async function createSession(identity, ttl) {
  const id = randomToken();
  await redis.set(sessionKey(id), JSON.stringify(identity), 'EX', ttl);
  return id;
}

export async function getSession(id) {
  if (!id) return null;
  const data = await redis.get(sessionKey(id));
  return data ? JSON.parse(data) : null;
}

export async function revokeSession(id) {
  if (id) await redis.del(sessionKey(id));
}

export function workspaceRole(session, workspace) {
  if (!config.pigeonKeys.has(workspace)) return undefined;
  return session.workspaces.find(({ id }) => id === workspace)?.role;
}
