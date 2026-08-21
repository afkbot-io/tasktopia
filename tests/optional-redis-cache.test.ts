import { describe, expect, it, vi } from "vitest";
import { OptionalRedisWorldCache, type RedisCommands } from "../src/server/optional-redis-cache";
import type { ChunkPayloadDto, ChunkPayloadV1Dto } from "../src/shared/contracts";
import { chunkPayloadContentHash } from "../src/server/world/chunk-payload-hash";

const payloadContent: Omit<ChunkPayloadV1Dto, "contentHash"> = { payloadVersion: 1, generatorVersion: "square-v7", terrainSeed: 1,
  publishedVersion: 2, lod: "OVERVIEW", chunkX: 0, chunkY: 0, size: 64, roads: [], surfaces: [],
  districts: [], tasks: [], worldFeatures: [], decorationContext: { cityBounds: [], districts: [], tasks: [] } };
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
});
