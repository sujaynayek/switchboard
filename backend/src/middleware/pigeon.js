import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config/env.js';

const maxBodyBytes = 1024 * 1024;

export async function authenticatePigeon(req, res, next) {
  const signature = /^t=(\d+),v1=([0-9a-fA-F]{64})$/.exec(req.get('x-pigeon-signature') ?? '');
  const now = Math.floor(Date.now() / 1000);
  if (!signature || Math.abs(now - Number(signature[1])) > 300) return res.sendStatus(401);

  const digest = createHmac('sha256', config.webhookSecret).update(signature[1] + '.');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    digest.update(chunk);
    size += chunk.length;
    if (size <= maxBodyBytes) chunks.push(chunk);
  }
  if (!timingSafeEqual(digest.digest(), Buffer.from(signature[2], 'hex'))) return res.sendStatus(401);
  if (size > maxBodyBytes) return res.sendStatus(400);
  try {
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    req.body = JSON.parse(raw);
  } catch {
    return res.sendStatus(400);
  }
  next();
}
