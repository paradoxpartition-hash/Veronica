import Redis from 'ioredis';

export const redis = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: Number(process.env.REDIS_PORT) || 6379,
  lazyConnect: true,
});

redis.on('error', (err) => {
  console.error('Redis error:', err.message);
});

// ─── Short-term memory (TTL-based) ───────────────────────────────────────────

export async function setMemory(key: string, value: any, ttl = 3600): Promise<void> {
  await redis.set(key, JSON.stringify(value), 'EX', ttl);
}

export async function getMemory(key: string): Promise<any> {
  const raw = await redis.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}

export async function deleteMemory(key: string): Promise<void> {
  await redis.del(key);
}

export async function setLastTopic(userId: string, topic: string): Promise<void> {
  await setMemory(`last_topic:${userId}`, topic, 1800);
}

export async function getLastTopic(userId: string): Promise<string> {
  return (await getMemory(`last_topic:${userId}`)) || '';
}

// ─── Long-term memory (no TTL — persists across restarts) ────────────────────

export async function remember(key: string, value: any): Promise<void> {
  await redis.set(`veronica:memory:${key}`, JSON.stringify(value));
}

export async function recall(key: string): Promise<any> {
  const raw = await redis.get(`veronica:memory:${key}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}

export async function forget(key: string): Promise<void> {
  await redis.del(`veronica:memory:${key}`);
}
