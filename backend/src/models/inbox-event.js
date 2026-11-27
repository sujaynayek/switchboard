import { randomUUID } from 'node:crypto';

export function inboxEvent(type, fields) {
  return { id: randomUUID(), type, ...fields };
}

// Mongo update expression used when the state change and outbox append must be atomic.
export function appendEvent(expression) {
  return { $concatArrays: [{ $ifNull: ['$outbox', []] }, [expression]] };
}
