import { randomUUID } from 'node:crypto';
import { redis } from '../config/stores.js';

const prefix = 'switchboard:phase1:';
const bucketKey = (workspace) => prefix + 'bucket:' + workspace;
const cooldownKey = (workspace) => prefix + 'cooldown:' + workspace;
const sendLockKey = (workspace) => prefix + 'send:' + workspace;

const takeTokenScript = `
local cooldown = redis.call('PTTL', KEYS[2])
if cooldown > 0 then return cooldown end
local clock = redis.call('TIME')
local now = clock[1] * 1000 + math.floor(clock[2] / 1000)
local bucket = redis.call('HMGET', KEYS[1], 'tokens', 'at')
local previous = tonumber(bucket[2]) or now
now = math.max(now, previous)
local tokens = math.min(8, (tonumber(bucket[1]) or 8) + (now - previous) * 0.004)
if tokens < 1 then return math.ceil((1 - tokens) / 0.004) end
redis.call('HSET', KEYS[1], 'tokens', tokens - 1, 'at', now)
redis.call('PEXPIRE', KEYS[1], 3000)
return 0
`;

export function takeToken(workspace) {
  return redis.eval(takeTokenScript, 2, bucketKey(workspace), cooldownKey(workspace));
}

export function pauseWorkspace(workspace, delay) {
  return redis.eval(
    "if redis.call('PTTL', KEYS[1]) < tonumber(ARGV[1]) then return redis.call('SET', KEYS[1], '1', 'PX', ARGV[1]) end",
    1, cooldownKey(workspace), delay,
  );
}

export async function acquireSendLock(workspace, ttl = 8000) {
  const key = sendLockKey(workspace);
  const owner = randomUUID();
  if (await redis.set(key, owner, 'PX', ttl, 'NX') !== 'OK') return null;
  return {
    isHeld: async () => await redis.get(key) === owner,
    release: () => redis.eval(
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0",
      1, key, owner,
    ),
  };
}

export function clearRateLimits(workspaces) {
  return redis.del(...workspaces.flatMap((workspace) => [bucketKey(workspace), cooldownKey(workspace)]));
}
