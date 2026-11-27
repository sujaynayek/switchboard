import { config } from '../config/env.js';
import { getSession, readCookie, sessionCookie, workspaceRole } from '../services/sessions.js';

const allowedOrigins = new Set([config.webOrigin, new URL(config.oidc.redirectUri).origin]);

export function acceptsOrigin(origin) {
  return origin === undefined || allowedOrigins.has(origin);
}

export function requireSameOrigin(req, res, next) {
  if (!acceptsOrigin(req.get('origin')) ||
      (req.get('origin') === undefined && req.get('sec-fetch-site') === 'cross-site')) return res.sendStatus(403);
  next();
}

export async function requireSession(req, res, next) {
  const session = await getSession(readCookie(req.headers.cookie, sessionCookie));
  if (!session) return res.sendStatus(401);
  req.session = session;
  next();
}

export function requireWorkspace(req, res, next) {
  const workspace = req.query.workspace;
  if (typeof workspace !== 'string' || !workspace) return res.sendStatus(400);
  const role = workspaceRole(req.session, workspace);
  if (!role) return res.sendStatus(403);
  req.workspace = workspace;
  req.role = role;
  next();
}
