import { setTimeout as sleep } from 'node:timers/promises';
import { config } from '../config/env.js';
import { deleteInboxRecords, state } from '../models/inbox.js';
import { acquireSendLock, clearRateLimits } from './rate-limit.js';

export async function resetInbox() {
  const workspaces = [...config.pigeonKeys.keys()];
  const locks = [];
  const deadline = Date.now() + 10000;
  try {
    // Acquire both workspace locks in order. Workers hold only one at a time.
    for (const workspace of workspaces) {
      let lock;
      while (!lock && Date.now() < deadline) {
        lock = await acquireSendLock(workspace, 30000);
        if (!lock) await sleep(50);
      }
      if (!lock) throw new Error('Unable to pause sends for reset');
      locks.push(lock);
    }
    const { generation } = await state.findOneAndUpdate(
      { _id: 'inbox' }, { $inc: { generation: 1 } }, { returnDocument: 'after' },
    );
    const old = { generation: { $lt: generation } };
    await Promise.all([deleteInboxRecords(old), clearRateLimits(workspaces)]);
  } finally {
    await Promise.all(locks.map((lock) => lock.release()));
  }
}
