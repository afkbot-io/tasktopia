import { describe, expect, it, vi } from "vitest";
import { OptionalRedisWorldCache, type RedisCommands } from "../src/server/optional-redis-cache";
import type { ChunkPayloadDto, ChunkPayloadV2Dto } from "../src/shared/contracts";
import { chunkPayloadContentHash } from "../src/server/world/chunk-payload-hash";

const payloadContent: Omit<ChunkPayloadV2Dto, "contentHash"> = { payloadVersion: 2, generatorVersion: "block-v1", terrainSeed: 1,
  publishedVersion: 2, lod: "OVERVIEW", chunkX: 0, chunkY: 0, size: 64, roadRuns: [], surfaceRuns: [],
  districts: [], tasks: [], worldFeatures: [], decorationContext: { treeGeometryVersion: 7, lightingVersion: 1, surfaceHaloRuns: [], blockedCellRuns: [], cityBounds: [], districts: [], tasks: [] } };
const payload: ChunkPayloadDto = { ...payloadContent, contentHash: chunkPayloadContentHash(payloadContent) };

describe("optional Redis world cache", () => {
  it("treats eviction as a normal cache miss", async () => {
    const client = { get: vi.fn().mockResolvedValue(null), setEx: vi.fn() } as RedisCommands;
    await expect(new OptionalRedisWorldCache(client).getChunk("missing")).resolves.toBeUndefined();
  });

  it("round-trips a versioned chunk without owning canonical state", async () => {
    const stored = new Map<string, string>();
    const client = {
      get: vi.fn(async (key: string) => stored.get(key) ?? null),
      setEx: vi.fn(async (key: string, _ttl: number, value: string) => { stored.set(key, value); }),
    } as RedisCommands;
    const cache = new OptionalRedisWorldCache(client, "test:", 60, 20);
    await cache.setChunk("chunk:country:0:0:OVERVIEW:2", payload);
    await expect(cache.getChunk("chunk:country:0:0:OVERVIEW:2")).resolves.toEqual(payload);
    expect([...stored.keys()].some((key) => key.includes(`chunk-content:${payload.contentHash}`))).toBe(true);
  });

  it.each([JSON.stringify(payload), "{malformed-json", "not-a-content-hash", "g".repeat(64)])(
    "ignores a retired or malformed locator without rewriting data or disabling valid cache reads: %s",
    async locator => {
      const stored = new Map<string,string>([
        ["strict:retired",locator], ["strict:valid",payload.contentHash],
        [`strict:chunk-content:${payload.contentHash}`,JSON.stringify(payload)],
      ]);
      const before = [...stored];
      const client = { get: vi.fn(async (key: string) => stored.get(key) ?? null), setEx: vi.fn() };
      const cache = new OptionalRedisWorldCache(client,"strict:");
      await expect(cache.getChunk("retired")).resolves.toBeUndefined();
      expect(client.get).toHaveBeenCalledTimes(1);
      await expect(cache.getChunk("valid")).resolves.toEqual(payload);
      expect(client.setEx).not.toHaveBeenCalled();
      expect([...stored]).toEqual(before);
    },
  );

  it("treats a locator/blob hash mismatch or corrupted blob as a cache miss", async () => {
    const stored = new Map<string, string>();
    stored.set("corrupt:chunk", payload.contentHash);
    stored.set(`corrupt:chunk-content:${payload.contentHash}`, JSON.stringify({ ...payload, terrainSeed: 999 }));
    const client = {
      get: vi.fn(async (key: string) => stored.get(key) ?? null),
      setEx: vi.fn(),
    } as RedisCommands;
    const cache = new OptionalRedisWorldCache(client, "corrupt:", 60, 20);

    await expect(cache.getChunk("chunk")).resolves.toBeUndefined();
  });

  it("uses one distributed builder for two replicas on a cold miss", async () => {
    const stored = new Map<string, string>();
    const client = {
      get: vi.fn(async (key: string) => stored.get(key) ?? null),
      setEx: vi.fn(async (key: string, _ttl: number, value: string) => { stored.set(key, value); }),
      set: vi.fn(async (key: string, value: string) => {
        if (stored.has(key)) return null;
        stored.set(key, value);
        return "OK";
      }),
      eval: vi.fn(async (_script: string, options: { keys: string[]; arguments: string[] }) => {
        if (stored.get(options.keys[0]!) === options.arguments[0]) stored.delete(options.keys[0]!);
      }),
    } as RedisCommands;
    const first = new OptionalRedisWorldCache(client, "shared:", 60, 20);
    const second = new OptionalRedisWorldCache(client, "shared:", 60, 20);
    let builds = 0;
    const build = async () => {
      builds += 1;
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      return payload;
    };

    const results = await Promise.all([
      first.getOrBuildChunk("chunk:country:0:0:OVERVIEW:2", build),
      second.getOrBuildChunk("chunk:country:0:0:OVERVIEW:2", build),
    ]);

    expect(builds).toBe(1);
    expect(results.map((result) => result.built).sort()).toEqual([false, true]);
  });

  it("stores the shared blob only after the canonical publication callback completes", async () => {
    let canonicalPublished = false;
    const client = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue("OK"),
      setEx: vi.fn(async () => { expect(canonicalPublished).toBe(true); }),
      eval: vi.fn().mockResolvedValue(1),
    } as RedisCommands;
    const cache = new OptionalRedisWorldCache(client, "ordered:", 60, 20);

    await cache.getOrBuildChunk("chunk", async () => {
      canonicalPublished = true;
      return payload;
    });

    expect(client.setEx).toHaveBeenCalledTimes(2);
  });

  it("fails open on errors and timeouts", async () => {
    const rejected = new OptionalRedisWorldCache({
      get: vi.fn().mockRejectedValue(new Error("offline")), setEx: vi.fn().mockRejectedValue(new Error("offline")),
    }, "test:", 60, 5);
    await expect(rejected.getChunk("key")).resolves.toBeUndefined();
    await expect(rejected.setChunk("key", payload)).resolves.toBeUndefined();

    const hanging = new OptionalRedisWorldCache({
      get: vi.fn(() => new Promise<string | null>(() => undefined)), setEx: vi.fn(() => new Promise<unknown>(() => undefined)),
    }, "test:", 60, 5);
    await expect(hanging.getChunk("key")).resolves.toBeUndefined();
  });

  it("returns the canonical chunk even when Redis lease release never settles", async () => {
    vi.useFakeTimers();
    try {
      const client = {
        get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue("OK"),
        setEx: vi.fn().mockResolvedValue(undefined),
        eval: vi.fn(() => new Promise<unknown>(() => undefined)),
      } satisfies RedisCommands;
      const cache = new OptionalRedisWorldCache(client, "release:", 60, 10);
      let returned: unknown;
      void cache.getOrBuildChunk("chunk", async () => payload).then(value => { returned = value; });
      await vi.advanceTimersByTimeAsync(25);
      expect(returned).toEqual({ payload, built: true });
    } finally { vi.useRealTimers(); }
  });

  it("uses one overall deadline while waiting for another Redis builder", async () => {
    vi.useFakeTimers();
    try {
      const client = {
        get: vi.fn().mockResolvedValueOnce(null).mockImplementation(() => new Promise<string | null>(() => undefined)),
        set: vi.fn().mockResolvedValue(null), setEx: vi.fn(),
      } satisfies RedisCommands;
      const build = vi.fn(async () => payload);
      const cache = new OptionalRedisWorldCache(client, "wait:", 60, 500, 60);
      let returned: unknown;
      void cache.getOrBuildChunk("chunk", build).then(value => { returned = value; });
      await vi.advanceTimersByTimeAsync(80);
      expect(returned).toEqual({ payload, built: true });
      expect(build).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  it("bounds graceful Redis shutdown and destroys a stalled connection", async () => {
    vi.useFakeTimers();
    try {
      const client = {
        get: vi.fn(), setEx: vi.fn(), close: vi.fn(() => new Promise<unknown>(() => undefined)), destroy: vi.fn(),
      };
      const cache = new OptionalRedisWorldCache(client, "close:", 60, 10);
      let closed = false;
      void cache.close().then(() => { closed = true; });
      await vi.advanceTimersByTimeAsync(20);
      expect(closed).toBe(true);
      expect(client.destroy).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
});
