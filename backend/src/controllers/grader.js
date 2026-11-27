import { config } from '../config/env.js';
import { claimConversation, queueReply, snapshot } from '../services/inbox.js';
import { resetInbox } from '../services/reset.js';
import { nonemptyString } from '../utils/validation.js';

function validRequest(body, fields) {
  return body && config.pigeonKeys.has(body.workspace) && fields.every((field) => nonemptyString(body[field]));
}

export async function reset(req, res) {
  await resetInbox();
  res.sendStatus(200);
}

export async function getSnapshot(req, res) {
  res.json(await snapshot());
}

export async function reply(req, res) {
  if (!validRequest(req.body, ['contact', 'text', 'client_ref'])) return res.sendStatus(400);
  await queueReply(req.body);
  res.sendStatus(202);
}

export async function claim(req, res) {
  if (!validRequest(req.body, ['contact', 'agent'])) return res.sendStatus(400);
  const held = await claimConversation(req.body);
  res.sendStatus(held ? 200 : 409);
}
