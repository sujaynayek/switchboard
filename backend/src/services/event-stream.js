import { config } from '../config/env.js';
import { db, redis } from '../config/stores.js';

const prefix = 'switchboard:' + db.databaseName + ':events:';
const generationKey = prefix + 'generation';
const workspacePrefix = (workspace) => prefix + workspace + ':';
const counterKey = (workspace) => workspacePrefix(workspace) + 'seq';
const streamKey = (workspace, generation) => workspacePrefix(workspace) + 'log:' + generation;
const dedupeKey = (workspace, generation) => workspacePrefix(workspace) + 'ids:' + generation;

const advanceGenerationScript = `
local previous = tonumber(redis.call('GET', KEYS[1]))
local next = tonumber(ARGV[1])
if previous and previous >= next then return end
if previous then
  for generation = previous, next - 1 do
    for index = 2, #ARGV do
      redis.call('UNLINK', ARGV[index] .. 'log:' .. generation, ARGV[index] .. 'ids:' .. generation)
    end
  end
end
redis.call('SET', KEYS[1], ARGV[1])
`;

const appendScript = `
local active = tonumber(redis.call('GET', KEYS[1]))
local generation = tonumber(ARGV[1])
if not active or active < generation then return -1 end
if active > generation or redis.call('SISMEMBER', KEYS[4], ARGV[2]) == 1 then return 0 end
redis.call('INCR', KEYS[2])
local seq = redis.call('GET', KEYS[2])
redis.call('XADD', KEYS[3], seq .. '-0', 'frame', ARGV[3])
redis.call('SADD', KEYS[4], ARGV[2])
return 1
`;

export function advanceEventGeneration(generation) {
  const workspaces = [...config.pigeonKeys.keys()];
  return redis.eval(advanceGenerationScript, 1, generationKey, generation, ...workspaces.map(workspacePrefix));
}

export async function publishEvent(workspace, generation, { id, ...frame }) {
  const result = await redis.eval(appendScript, 4,
    generationKey, counterKey(workspace), streamKey(workspace, generation), dedupeKey(workspace, generation),
    generation, id, JSON.stringify(frame));
  if (result === -1) throw new Error('Redis event generation is behind MongoDB');
}

export async function latestSequence(workspace) {
  return Number(await redis.get(counterKey(workspace)) ?? 0);
}

export async function readEvents(workspace, after) {
  const generation = await redis.get(generationKey);
  if (generation === null) return [];
  const rows = await redis.xrange(streamKey(workspace, generation), '(' + after + '-0', '+', 'COUNT', 100);
  return rows.map(([id, [, serialized]]) => ({ ...JSON.parse(serialized), seq: Number(id.split('-')[0]) }));
}
