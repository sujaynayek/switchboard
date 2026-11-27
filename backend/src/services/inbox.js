import { ObjectId } from 'mongodb';
import { config } from '../config/env.js';
import { conversations, currentGeneration, deleteInboxRecords, messages } from '../models/inbox.js';
import { appendEvent, inboxEvent } from '../models/inbox-event.js';

async function withInboxWrite(workspace, write) {
  const generation = await currentGeneration();
  const scope = { generation, workspace };
  try {
    return await write(scope);
  } finally {
    // Reset may have deleted this generation before an in-flight write landed.
    if (generation !== await currentGeneration()) await deleteInboxRecords(scope);
  }
}

export async function ensureConversation(scope, contact, activityAt) {
  const identity = { ...scope, contact };
  const defaults = { assignee: null, state: 'open' };
  const update = activityAt
    ? { $setOnInsert: defaults, $max: { lastActivityAt: activityAt } }
    : { $setOnInsert: { ...defaults, lastActivityAt: new Date() } };
  try {
    await conversations.updateOne(identity, update, { upsert: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
    if (activityAt) await conversations.updateOne(identity, { $max: { lastActivityAt: activityAt } });
  }
}

export async function claimConversation({ workspace, contact, agent }) {
  return withInboxWrite(workspace, async (scope) => {
    await ensureConversation(scope, contact);
    const event = inboxEvent('conversation.assigned', { contact, assignee: agent });
    const result = await conversations.updateOne(
      { ...scope, contact, assignee: { $in: [null, agent] } },
      [{ $set: {
        assignee: { $literal: agent },
        outbox: { $cond: [
          { $eq: ['$assignee', { $literal: agent }] },
          '$outbox',
          appendEvent({ $literal: event }),
        ] },
      } }],
    );
    return result.matchedCount === 1;
  });
}

export async function queueReply({ workspace, contact, text, client_ref: clientRef }) {
  return withInboxWrite(workspace, async (scope) => {
    const identity = { ...scope, direction: 'outbound', clientRef };
    const now = new Date();
    try {
      await messages.updateOne(identity, {
        $setOnInsert: {
          _id: new ObjectId(), contact, text, status: 'queued', pending: true,
          occurredAt: now, nextAttemptAt: now, leaseUntil: new Date(0),
          outbox: [inboxEvent('message.status', { contact, client_ref: clientRef, status: 'queued' })],
        },
      }, { upsert: true });
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
    const reply = await messages.findOne(identity, { projection: { contact: 1, occurredAt: 1 } });
    if (reply) await ensureConversation(scope, reply.contact, reply.occurredAt);
  });
}

export async function storeInbound({ id, workspace, occurredAt, data }) {
  return withInboxWrite(workspace, async (scope) => {
    const identity = { ...scope, direction: 'inbound', providerId: data.message_id };
    const event = inboxEvent('message.inbound', { contact: data.from, message_id: data.message_id });
    const projection = { contact: 1, occurredAt: 1 };
    try {
      const message = await messages.findOneAndUpdate(identity, {
        $setOnInsert: { contact: data.from, text: data.text, occurredAt, outbox: [event] },
        $addToSet: { eventIds: id },
      }, { upsert: true, returnDocument: 'after', projection });
      await ensureConversation(scope, message.contact, message.occurredAt);
    } catch (error) {
      if (error.code !== 11000) throw error;
      const existing = await messages.findOne(identity, { projection });
      if (!existing) return;
      try {
        await messages.updateOne(identity, { $addToSet: { eventIds: id } });
      } catch (receiptError) {
        if (receiptError.code !== 11000) throw receiptError;
      }
      await ensureConversation(scope, existing.contact, existing.occurredAt);
    }
  });
}

export async function recordStatus({ id, workspace, data }) {
  const generation = await currentGeneration();
  const { status, client_ref: clientRef, message_id: providerId } = data;
  const allowedFrom = status === 'sent' ? ['queued'] : ['queued', 'sent'];
  const advances = { $in: ['$status', allowedFrom] };
  const event = inboxEvent('message.status', { client_ref: clientRef, status });
  try {
    await messages.updateOne({
      generation, workspace, direction: 'outbound', clientRef,
      attempts: { $gt: 0 },
      $or: [{ providerId }, { providerId: { $exists: false } }],
      eventIds: { $ne: id },
    }, [{
      $set: {
        eventIds: { $concatArrays: [{ $ifNull: ['$eventIds', []] }, [{ $literal: id }]] },
        providerId: { $literal: providerId },
        pending: false,
        status: { $cond: [advances, status, '$status'] },
        outbox: { $cond: [
          advances, appendEvent({ ...event, client_ref: { $literal: clientRef }, contact: '$contact' }), '$outbox',
        ] },
      },
    }]);
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
}

function conversationView({ contact, assignee, state, lastActivityAt }) {
  return { contact, assignee, state: state ?? 'open', last_activity_at: lastActivityAt ?? null };
}

export async function listConversations(workspace, { limit, offset }) {
  const generation = await currentGeneration();
  const rows = await conversations.find({ generation, workspace })
    .sort({ lastActivityAt: -1, contact: 1 }).skip(offset).limit(limit + 1).toArray();
  return {
    conversations: rows.slice(0, limit).map(conversationView),
    next_offset: rows.length > limit ? offset + limit : null,
  };
}

export async function getConversation(workspace, contact) {
  const generation = await currentGeneration();
  const row = await conversations.findOne({ generation, workspace, contact });
  return row && conversationView(row);
}

export async function getMessageHistory(workspace, contact, { limit, offset }) {
  const generation = await currentGeneration();
  const filter = { generation, workspace, contact };
  if (!await conversations.findOne(filter, { projection: { _id: 1 } })) return null;
  const rows = await messages.find(filter).sort({ occurredAt: -1, providerId: -1, _id: -1 })
    .skip(offset).limit(limit + 1).toArray();
  return {
    messages: rows.slice(0, limit).reverse().map((row) => ({
      id: row._id, direction: row.direction, text: row.text, occurred_at: row.occurredAt,
      message_id: row.providerId, client_ref: row.clientRef, status: row.status,
    })),
    next_offset: rows.length > limit ? offset + limit : null,
  };
}

export async function setConversationState({ workspace, contact, agent, role, nextState }) {
  return withInboxWrite(workspace, async (scope) => {
    const identity = { ...scope, contact };
    const permitted = role === 'admin' ? identity : { ...identity, assignee: { $in: [null, agent] } };
    const event = inboxEvent('conversation.state', { contact, state: nextState });
    const result = await conversations.updateOne(permitted, [{ $set: {
      state: nextState,
      outbox: { $cond: [
        { $eq: [{ $ifNull: ['$state', 'open'] }, nextState] },
        '$outbox',
        appendEvent({ $literal: event }),
      ] },
    } }]);
    if (result.matchedCount) return 200;
    return await conversations.findOne(identity, { projection: { _id: 1 } }) ? 403 : 404;
  });
}

export function orderedInbound(filter) {
  return messages.find({ ...filter, direction: 'inbound' }).sort({ occurredAt: 1, providerId: 1 });
}

export async function snapshot() {
  const generation = await currentGeneration();
  const workspaces = Object.fromEntries(
    [...config.pigeonKeys.keys()].map((workspace) => [
      workspace, { contacts: Object.create(null), outbound: Object.create(null) },
    ]),
  );
  const [threads, inbound, outbound] = await Promise.all([
    conversations.find({ generation }).toArray(),
    orderedInbound({ generation }).toArray(),
    messages.find({ generation, direction: 'outbound' }).toArray(),
  ]);
  for (const { workspace, contact, assignee } of threads) {
    workspaces[workspace].contacts[contact] = { inbound: [], assignee };
  }
  for (const { workspace, contact, providerId } of inbound) {
    const thread = workspaces[workspace].contacts[contact] ??= { inbound: [], assignee: null };
    thread.inbound.push(providerId);
  }
  for (const { workspace, contact, clientRef, status } of outbound) {
    workspaces[workspace].contacts[contact] ??= { inbound: [], assignee: null };
    workspaces[workspace].outbound[clientRef] = status;
  }
  return { workspaces };
}
