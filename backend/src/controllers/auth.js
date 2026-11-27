import { config } from '../config/env.js';
import { authorizationUrl, exchangeCode } from '../services/oidc.js';
import {
  beginLogin, consumeLogin, cookieOptions, createSession, loginCookie, readCookie,
  revokeSession, sessionCookie, validToken,
} from '../services/sessions.js';

const loginCookieOptions = { ...cookieOptions, path: '/auth/callback' };

export async function login(req, res) {
  const transaction = await beginLogin();
  const location = await authorizationUrl(transaction);
  res.cookie(loginCookie(transaction.state), transaction.binding, { ...loginCookieOptions, maxAge: 600_000 });
  res.redirect(location);
}

export async function callback(req, res) {
  const { code, state } = req.query;
  if (!validToken(state) || typeof code !== 'string' || !code || code.length > 1024) return res.sendStatus(400);
  const cookie = loginCookie(state);
  const transaction = await consumeLogin(state, readCookie(req.headers.cookie, cookie));
  if (!transaction) return res.sendStatus(400);
  res.clearCookie(cookie, loginCookieOptions);

  const authenticated = await exchangeCode(code, transaction);
  if (!authenticated) return res.sendStatus(401);
  await revokeSession(readCookie(req.headers.cookie, sessionCookie));
  const id = await createSession(authenticated.identity, authenticated.ttl);
  res.cookie(sessionCookie, id, { ...cookieOptions, maxAge: authenticated.ttl * 1000 });
  res.set('Referrer-Policy', 'no-referrer');
  res.redirect(303, config.webOrigin + '/');
}

export async function logout(req, res) {
  await revokeSession(readCookie(req.headers.cookie, sessionCookie));
  res.clearCookie(sessionCookie, cookieOptions);
  res.sendStatus(204);
}
