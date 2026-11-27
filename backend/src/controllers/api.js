import {
  claimConversation, getConversation, getMessageHistory, listConversations, queueReply, setConversationState,
} from '../services/inbox.js';
import { nonemptyString } from '../utils/validation.js';

function page(query) {
  const number = (value, fallback) => value === undefined ? fallback :
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  const limit = number(query.limit, 25);
  const offset = number(query.offset, 0);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
      !Number.isSafeInteger(offset) || offset > 2_000_000_000) return null;
  return { limit, offset };
}

export async function list(req, res) {
  const pagination = page(req.query);
  if (!pagination) return res.sendStatus(400);
  res.json(await listConversations(req.workspace, pagination));
}

export async function detail(req, res) {
  const conversation = await getConversation(req.workspace, req.params.contact);
  if (!conversation) return res.sendStatus(404);
  res.json(conversation);
}

export async function history(req, res) {
  const pagination = page(req.query);
  if (!pagination) return res.sendStatus(400);
  const messages = await getMessageHistory(req.workspace, req.params.contact, pagination);
  if (!messages) return res.sendStatus(404);
  res.json(messages);
}

export async function claim(req, res) {
  const held = await claimConversation({
    workspace: req.workspace, contact: req.params.contact, agent: req.session.sub,
  });
  res.sendStatus(held ? 200 : 409);
}

export async function reply(req, res) {
  const { text, client_ref } = req.body ?? {};
  if (!nonemptyString(text) || !nonemptyString(client_ref)) return res.sendStatus(400);
  await queueReply({ workspace: req.workspace, contact: req.params.contact, text, client_ref });
  res.sendStatus(202);
}

export function changeState(nextState) {
  return async (req, res) => {
    const status = await setConversationState({
      workspace: req.workspace, contact: req.params.contact, agent: req.session.sub, role: req.role, nextState,
    });
    res.sendStatus(status);
  };
}
