import { config } from '../config/env.js';
import { recordStatus, storeInbound } from '../services/inbox.js';
import { deliveryStatuses, isRecord, nonemptyString } from '../utils/validation.js';

export async function receivePigeon(req, res) {
  if (!isRecord(req.body)) return res.sendStatus(400);
  const { id, type, workspace, occurred_at, data } = req.body;
  if (!nonemptyString(type)) return res.sendStatus(400);
  if (type !== 'message.inbound' && type !== 'message.status') return res.sendStatus(204);
  if (!nonemptyString(workspace)) return res.sendStatus(400);
  if (!config.pigeonKeys.has(workspace)) return res.sendStatus(204);

  if (!nonemptyString(occurred_at)) return res.sendStatus(400);
  const occurredAt = new Date(occurred_at);
  if (!nonemptyString(id) || !Number.isFinite(occurredAt.getTime()) ||
      !isRecord(data) || !nonemptyString(data.message_id)) return res.sendStatus(400);

  if (type === 'message.inbound') {
    if (!nonemptyString(data.from) || typeof data.text !== 'string') return res.sendStatus(400);
    await storeInbound({ id, workspace, occurredAt, data });
  } else {
    if (!nonemptyString(data.client_ref) || !nonemptyString(data.status)) return res.sendStatus(400);
    if (deliveryStatuses.has(data.status)) await recordStatus({ id, workspace, data });
  }
  res.sendStatus(204);
}
