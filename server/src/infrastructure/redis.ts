import Redis from 'ioredis';
import { RedisStore } from 'rate-limit-redis';
import { runtimeConfig } from './runtimeConfig.js';

let client: Redis | null = null;

export function redisConfigured(): boolean {
  return Boolean(runtimeConfig.redisUrl);
}

export function getRedisClient(): Redis {
  if (!runtimeConfig.redisUrl) throw new Error('REDIS_URL is not configured');
  if (!client) client = new Redis(runtimeConfig.redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: true, lazyConnect: false });
  return client;
}

export async function checkRedis(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  try {
    await getRedisClient().ping();
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, error: error instanceof Error ? error.message : 'redis check failed' };
  }
}

export function createDistributedRateLimitStore(prefix: string): RedisStore {
  const redis = getRedisClient();
  return new RedisStore({
    prefix: `wager-arena:${prefix}:`,
    sendCommand: async (...args: string[]) => {
      const [command, ...commandArgs] = args;
      if (!command) throw new Error('Redis command is required');
      return redis.call(command, ...commandArgs) as Promise<boolean | number | string | Array<boolean | number | string>>;
    },
  });
}

export async function closeRedis(): Promise<void> {
  if (!client) return;
  await client.quit();
  client = null;
}
