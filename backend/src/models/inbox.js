import { db } from '../config/stores.js';

export const messages = db.collection('messages');
export const conversations = db.collection('conversations');
export const state = db.collection('application_state');

export async function initializeModels() {
  await Promise.all([
    conversations.createIndex({ generation: 1, workspace: 1, contact: 1 }, { unique: true }),
    messages.createIndexes([
      { key: { generation: 1, workspace: 1, eventIds: 1 }, unique: true,
        partialFilterExpression: { eventIds: { $exists: true } } },
      { key: { generation: 1, workspace: 1, providerId: 1 }, unique: true,
        partialFilterExpression: { direction: 'inbound' } },
      { key: { generation: 1, workspace: 1, clientRef: 1 }, unique: true,
        partialFilterExpression: { direction: 'outbound' } },
      { key: { generation: 1, workspace: 1, pending: 1, nextAttemptAt: 1, leaseUntil: 1 } },
      { key: { generation: 1, direction: 1, occurredAt: 1, providerId: 1 } },
    ]),
  ]);
  try {
    await state.updateOne({ _id: 'inbox' }, { $setOnInsert: { generation: 0 } }, { upsert: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
}

export async function currentGeneration() {
  return (await state.findOne({ _id: 'inbox' })).generation;
}

export async function deleteInboxRecords(filter) {
  await Promise.all([messages.deleteMany(filter), conversations.deleteMany(filter)]);
}
