import { timingSafeEqual } from 'node:crypto';

export function secretsMatch(value, expected) {
  if (typeof value !== 'string' || value.length === 0) return false;
  const actualBytes = Buffer.from(value);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}
