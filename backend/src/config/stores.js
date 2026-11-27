import Redis from 'ioredis';
import { MongoClient } from 'mongodb';
import { config } from './env.js';

export const mongo = new MongoClient(config.mongoUrl, {
  writeConcern: { w: 'majority', j: true },
  serverSelectionTimeoutMS: 2500,
  socketTimeoutMS: 3500,
});
export const db = mongo.db();
export const redis = new Redis(config.redisUrl, {
  lazyConnect: true,
  enableOfflineQueue: false,
  commandTimeout: 2000,
});
redis.on('error', (error) => console.error('Redis:', error.message));

export async function checkStores() {
  await Promise.all([db.command({ ping: 1 }), redis.ping()]);
}
