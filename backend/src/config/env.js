import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
const env = process.env;

export const config = {
  port: Number(env.PORT ?? 4000),
  mongoUrl: env.MONGO_URL ?? 'mongodb://localhost:27017/switchboard',
  redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
  graderToken: env.GRADER_TOKEN ?? 'grader-dev-token',
  pigeonUrl: env.PIGEON_URL ?? 'http://localhost:4010',
  webhookSecret: env.PIGEON_WEBHOOK_SECRET ?? 'whsec_pigeon_dev',
  pigeonKeys: new Map([
    ['ws_acme', env.PIGEON_KEY_WS_ACME ?? 'pk_acme_7d1f0a'],
    ['ws_globex', env.PIGEON_KEY_WS_GLOBEX ?? 'pk_globex_c93b22'],
  ]),
};
