import Redis from "ioredis";

const redis = new Redis({
    host: process.env.REDIS_HOST || "redis"
});

export async function setMemory(key: string, value: any) {
    await redis.set(key, JSON.stringify(value), "EX", 3600);
}

export async function getMemory(key: string) {
    const value = await redis.get(key);

    if (!value) {
        return null;
    }

    return JSON.parse(value);
}
