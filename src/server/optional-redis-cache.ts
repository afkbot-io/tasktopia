import { createClient } from "redis";
import { randomUUID } from "node:crypto";
import type { ChunkPayloadDto } from "../shared/contracts";
import { chunkPayloadContentHash } from "./world/chunk-payload-hash";

export type RedisCommands = {
  isReady?: boolean;
  get(key: string): Promise<string | null>;
  set?(key: string, value: string, options: { NX: true; PX: number }): Promise<string | null>;
  setEx(key: string, ttlSeconds: number, value: string): Promise<unknown>;
  eval?(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
  close?(): Promise<unknown>;
  connect?(): Promise<unknown>;
  on?(event: string, listener: (error: Error) => void): unknown;
};

export interface SharedWorldCache {
  getChunk(key: string): Promise<ChunkPayloadDto | undefined>;
  setChunk(key: string, payload: ChunkPayloadDto): Promise<void>;
  getOrBuildChunk?(key: string, build: () => Promise<ChunkPayloadDto>): Promise<{ payload: ChunkPayloadDto; built: boolean }>;
  close(): Promise<void>;
}

function timeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Redis operation timed out")), timeoutMs);
    void promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/** Redis is an evictable acceleration layer; every failure is a cache miss. */
export class OptionalRedisWorldCache implements SharedWorldCache {
  private retryAfter = 0;

  constructor(
    private readonly client: RedisCommands,
    private readonly prefix = "tasktopia:v1:",
    private readonly ttlSeconds = 300,
    private readonly operationTimeoutMs = 40,
  ) {}

  private key(key: string): string { return `${this.prefix}${key}`; }

  private parsedChunk(value: string, locator?: string): ChunkPayloadDto | undefined {
    const payload = JSON.parse(value) as ChunkPayloadDto;
    if (!payload || typeof payload !== "object" || typeof payload.contentHash !== "string") return undefined;
    if (locator !== undefined && locator !== payload.contentHash) return undefined;
    const { contentHash, ...content } = payload;
    return chunkPayloadContentHash(content) === contentHash ? payload : undefined;
  }

  async getChunk(key: string): Promise<ChunkPayloadDto | undefined> {
    if (Date.now() < this.retryAfter || this.client.isReady === false) return undefined;
    try {
      const locator = await timeout(this.client.get(this.key(key)), this.operationTimeoutMs);
      if (!locator) return undefined;
      // Backward compatibility for cache entries written before content-addressed blobs.
      if (locator.startsWith("{")) return this.parsedChunk(locator);
      const value = await timeout(this.client.get(this.key(`chunk-content:${locator}`)), this.operationTimeoutMs);
      return value ? this.parsedChunk(value, locator) : undefined;
    } catch {
      this.retryAfter = Date.now() + 1_000;
      return undefined;
    }
  }

  async setChunk(key: string, payload: ChunkPayloadDto): Promise<void> {
    if (Date.now() < this.retryAfter || this.client.isReady === false) return;
    try {
      await timeout(Promise.all([
        this.client.setEx(this.key(`chunk-content:${payload.contentHash}`), this.ttlSeconds, JSON.stringify(payload)),
        this.client.setEx(this.key(key), this.ttlSeconds, payload.contentHash),
      ]), this.operationTimeoutMs);
    } catch {
      this.retryAfter = Date.now() + 1_000;
    }
  }

  async getOrBuildChunk(
    key: string,
    build: () => Promise<ChunkPayloadDto>,
  ): Promise<{ payload: ChunkPayloadDto; built: boolean }> {
    const cached = await this.getChunk(key);
    if (cached) return { payload: cached, built: false };
    if (!this.client.set || Date.now() < this.retryAfter || this.client.isReady === false) {
      return { payload: await build(), built: true };
    }
    const leaseKey = this.key(`build-lease:${key}`);
    const token = randomUUID();
    let acquired: boolean;
    try {
      acquired = await timeout(this.client.set(leaseKey, token, { NX: true, PX: 15_000 }), this.operationTimeoutMs) === "OK";
    } catch {
      this.retryAfter = Date.now() + 1_000;
      return { payload: await build(), built: true };
    }
    if (!acquired) {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
        const shared = await this.getChunk(key);
        if (shared) return { payload: shared, built: false };
      }
      // A dead owner or a slow optional cache must never block PostgreSQL.
      return { payload: await build(), built: true };
    }
    try {
      const payload = await build();
      await this.setChunk(key, payload);
      return { payload, built: true };
    } finally {
      try {
        await this.client.eval?.(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          { keys: [leaseKey], arguments: [token] },
        );
      } catch { /* Lease expires automatically; release is best effort. */ }
    }
  }

  async close(): Promise<void> {
    try { await this.client.close?.(); } catch { /* Optional cache shutdown is best effort. */ }
  }
}

export function createOptionalRedisWorldCache(
  redisUrl: string | undefined,
  options: { prefix?: string; ttlSeconds?: number; operationTimeoutMs?: number } = {},
): SharedWorldCache | undefined {
  if (!redisUrl) return undefined;
  const client = createClient({
    url: redisUrl,
    socket: {
      connectTimeout: Math.max(100, options.operationTimeoutMs ?? 40),
      reconnectStrategy: (retries) => Math.min(5_000, 100 * 2 ** Math.min(retries, 5)),
    },
  }) as unknown as RedisCommands;
  client.on?.("error", () => undefined);
  void client.connect?.().catch(() => undefined);
  return new OptionalRedisWorldCache(
    client,
    options.prefix,
    options.ttlSeconds,
    options.operationTimeoutMs,
  );
}
