import { setTimeout as sleep } from 'node:timers/promises';
import { conversations, currentGeneration, messages } from '../models/inbox.js';
import { advanceEventGeneration, publishEvent } from '../services/event-stream.js';
import { ensureConversation } from '../services/inbox.js';

async function flush(collection, generation, signal) {
  const rows = await collection.find({ generation, 'outbox.0': { $exists: true } }, {
    projection: { workspace: 1, contact: 1, occurredAt: 1, outbox: 1 },
  }).sort({ _id: 1 }).limit(50).toArray();

  for (const row of rows) {
    if (signal.aborted) break;
    const { _id, workspace, contact, occurredAt, outbox } = row;
    if (occurredAt) {
      const scope = { generation, workspace };
      await ensureConversation(scope, contact, occurredAt);
      if (generation !== await currentGeneration()) {
        await conversations.deleteOne({ ...scope, contact });
        continue;
      }
    }
    for (const event of outbox) await publishEvent(workspace, generation, event);
    // Redis deduplicates IDs if another worker publishes the same batch or this worker dies here.
    await collection.updateOne({ _id, generation }, { $pull: { outbox: { id: { $in: outbox.map(({ id }) => id) } } } });
  }
  return rows.length;
}

export async function startEventPublisher(signal) {
  let publishedGeneration;
  while (!signal.aborted) {
    let delay = 150;
    try {
      const generation = await currentGeneration();
      if (generation !== publishedGeneration) {
        await advanceEventGeneration(generation);
        publishedGeneration = generation;
      }
      const batches = await Promise.allSettled([flush(messages, generation, signal), flush(conversations, generation, signal)]);
      for (const result of batches) {
        if (result.status === 'rejected') throw result.reason;
        if (result.value === 50) delay = 0;
      }
    } catch (error) {
      if (!signal.aborted) console.error('Event publisher:', error.message);
      publishedGeneration = undefined;
      delay = 1000;
    }
    if (delay) await sleep(delay, undefined, { signal }).catch(() => {});
  }
}
