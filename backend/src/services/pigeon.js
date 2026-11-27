import { config } from '../config/env.js';

export async function sendToPigeon(message, signal) {
  const response = await fetch(new URL('/v1/messages', config.pigeonUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + config.pigeonKeys.get(message.workspace),
      'idempotency-key': 'switchboard-' + message._id.toHexString(),
    },
    body: JSON.stringify({ to: message.contact, text: message.text, client_ref: message.clientRef }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]),
  });
  if (response.status === 200) {
    const { id, status } = await response.json();
    if (status !== 'accepted' || typeof id !== 'string' || id.length === 0) {
      throw new Error('Unexpected Pigeon acceptance response');
    }
    return { providerId: id };
  }
  await response.body?.cancel();
  if (response.status === 429) {
    const value = response.headers.get('retry-after');
    const seconds = value && /^\d+$/.test(value) ? Number(value) : 2;
    return { retryAfter: seconds * 1000 + 100 };
  }
  if (response.status >= 500) return {};
  return { rejected: true };
}
