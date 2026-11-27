import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { config } from '../config/env.js';
import { currentGeneration, messages } from '../models/inbox.js';
import { sendToPigeon } from '../services/pigeon.js';
import { acquireSendLock, pauseWorkspace, takeToken } from '../services/rate-limit.js';

async function deliverNext(workspace, signal) {
  const lock = await acquireSendLock(workspace);
  if (!lock) return 100;

  try {
    const now = new Date();
    const ready = {
      generation: await currentGeneration(), workspace, pending: true,
      nextAttemptAt: { $lte: now }, leaseUntil: { $lte: now },
    };
    const next = await messages.findOne(ready, { sort: { nextAttemptAt: 1, _id: 1 }, projection: { _id: 1 } });
    if (!next) return 100;
    const wait = await takeToken(workspace);
    if (wait) return Math.max(wait, 20);

    const lease = randomUUID();
    const message = await messages.findOneAndUpdate({ ...ready, _id: next._id }, {
      $set: { lease, leaseUntil: new Date(Date.now() + 8000) },
      $inc: { attempts: 1 },
    }, { returnDocument: 'after' });
    if (!message || signal.aborted || !await lock.isHeld()) return 100;

    let result;
    try {
      result = await sendToPigeon(message, signal);
    } catch (error) {
      if (signal.aborted) return 0;
      result = {};
    }

    const active = { _id: message._id, lease, pending: true };
    const releaseLease = { lease: '', leaseUntil: '' };
    if (result.providerId || result.rejected) {
      const update = { pending: false };
      if (result.providerId) Object.assign(update, { providerId: result.providerId, status: 'sent' });
      else update.status = 'failed';
      await messages.updateOne(active, { $set: update, $unset: releaseLease });
    } else {
      if (result.retryAfter) await pauseWorkspace(workspace, result.retryAfter);
      const backoff = Math.min(4000, 500 * 2 ** (message.attempts - 1)) + Math.random() * 200;
      const nextAttemptAt = new Date(Date.now() + (result.retryAfter ?? backoff));
      await messages.updateOne(active, {
        $set: { nextAttemptAt, leaseUntil: new Date(0) }, $unset: { lease: '' },
      });
    }
    return 0;
  } finally {
    await lock.release();
  }
}

export function startDeliveryWorker(signal) {
  return Promise.all([...config.pigeonKeys.keys()].map(async (workspace) => {
    while (!signal.aborted) {
      let delay;
      try {
        delay = await deliverNext(workspace, signal);
      } catch (error) {
        if (signal.aborted) break;
        console.error('Delivery worker:', error.message);
        delay = 1000;
      }
      if (delay) await sleep(Math.min(delay, 1000), undefined, { signal }).catch(() => {});
    }
  }));
}
