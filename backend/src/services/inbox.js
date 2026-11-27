import { ObjectId } from 'mongodb';
import { config } from '../config/env.js';
import { conversations, currentGeneration, deleteInboxRecords, messages } from '../models/inbox.js';

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

async function ensureConversation(scope, contact) {
  try {
    await conversations.updateOne(
      { ...scope, contact }, { $setOnInsert: { assignee: null } }, { upsert: true },
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
}

export async function claimConversation({ workspace, contact, agent }) {
  return withInboxWrite(workspace, async (scope) => {
    await ensureConversation(scope, contact);
    const result = await conversations.updateOne(
      { ...scope, contact, assignee: { $in: [null, agent] } },
      { $set: { assignee: agent } },
    );
    return result.matchedCount === 1;
  });
}

export async function queueReply({ workspace, contact, text, client_ref: clientRef }) {
  return withInboxWrite(workspace, async (scope) => {
    const identity = { ...scope, direction: 'outbound', clientRef };
    try {
      await messages.updateOne(identity, {
        $setOnInsert: {
          _id: new ObjectId(), contact, text, status: 'queued', pending: true,
          occurredAt: new Date(), nextAttemptAt: new Date(), leaseUntil: new Date(0),
        },
      }, { upsert: true });
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
    const reply = await messages.findOne(identity);
    if (reply) await ensureConversation(scope, reply.contact);
  });
}

export async function storeInbound({ id, workspace, occurredAt, data }) {
  return withInboxWrite(workspace, async (scope) => {
    const identity = { ...scope, direction: 'inbound', providerId: data.message_id };
    try {
      const message = await messages.findOneAndUpdate(identity, {
        $setOnInsert: { contact: data.from, text: data.text, occurredAt },
        $addToSet: { eventIds: id },
      }, { upsert: true, returnDocument: 'after' });
      await ensureConversation(scope, message.contact);
    } catch (error) {
      if (error.code !== 11000) throw error;
      // The other write may have inserted this same message first.
      const existing = await messages.findOne(identity);
      if (!existing) return;
      try {
        await messages.updateOne(identity, { $addToSet: { eventIds: id } });
      } catch (receiptError) {
        if (receiptError.code !== 11000) throw receiptError;
      }
      await ensureConversation(scope, existing.contact);
    }
  });
}

export async function recordStatus({ id, workspace, data }) {
  const generation = await currentGeneration();
  const { status, client_ref: clientRef, message_id: providerId } = data;
  const allowedFrom = status === 'sent' ? ['queued'] : ['queued', 'sent'];
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
        status: { $cond: [{ $in: ['$status', allowedFrom] }, status, '$status'] },
      },
    }]);
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
}

// Shared chronological ordering for snapshot and future conversation history.
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
