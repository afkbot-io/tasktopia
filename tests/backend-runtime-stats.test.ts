import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppService } from "../src/server/app-service";
import { createTestDb, type Db } from "../src/server/db";
import { registerUser } from "../src/server/auth";
import { startBackgroundPoll } from "../src/server/background-poll";
import { PostgresWorldGenerationDispatcher, readWorldGenerationQueueStats } from "../src/server/world-generation-jobs";

describe("bounded operator runtime snapshots", () => {
  let db: Db; let service: AppService; let countryId: string; let cityId: string;
  beforeEach(async () => {
    db = await createTestDb(); service = new AppService(db);
    countryId = (await registerUser(db, { email: "runtime-stats@example.test", name: "PRIVATE_COUNTRY_OWNER", password: "password123" })).user.countryId;
    await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(countryId);
    cityId = (await service.createCity(countryId, { name: "PRIVATE_CITY_NAME", idempotencyKey: "runtime-city" })).id;
  });
  afterEach(async () => { vi.useRealTimers(); await db?.close(); });

  it("observes actual scene cache misses/builds/hits through a synchronous query-free snapshot", async () => {
    await service.getCityScene(countryId, cityId);
    const before = service.runtimeStats();
    await service.getCityScene(countryId, cityId);
    const prepare = vi.spyOn(db, "prepare");
    const snapshot = service.runtimeStats();
    expect(prepare).not.toHaveBeenCalled(); prepare.mockRestore();
    expect(snapshot.caches.cityScenes.hits).toBe(before.caches.cityScenes.hits + 1);
    expect(snapshot.caches.cityScenes.builds).toBe(before.caches.cityScenes.builds);
    expect(snapshot.caches.cityScenes.entries).toBeLessThanOrEqual(snapshot.caches.cityScenes.maxEntries);
    expect(JSON.stringify(snapshot)).not.toContain(countryId);
    expect(JSON.stringify(snapshot)).not.toContain("PRIVATE_");
  });

  it("tracks poll failure/backoff/recovery without exposing errors or running a second operation", async () => {
    vi.useFakeTimers(); let attempts = 0;
    const poll = startBackgroundPoll(async () => { if (++attempts === 1) throw new Error("PRIVATE_DATABASE_URI"); }, 100, () => undefined);
    try {
      await vi.advanceTimersByTimeAsync(100);
      expect(poll.runtimeStats()).toMatchObject({ attempts: 1, errors: 1, consecutiveFailures: 1, running: false });
      expect(poll.runtimeStats().backoffRemainingMs).toBeGreaterThan(0);
      await vi.advanceTimersByTimeAsync(200);
      expect(poll.runtimeStats()).toMatchObject({ attempts: 2, successes: 1, consecutiveFailures: 0 });
      expect(JSON.stringify(poll.runtimeStats())).not.toContain("PRIVATE_");
    } finally { await poll.close(); }
    expect(poll.runtimeStats().closed).toBe(true);
  });

  it("coalesces cached aggregate queue reads and reports dispatcher observers without payload or identity", async () => {
    const dispatcher = new PostgresWorldGenerationDispatcher(db, 200, 50);
    try {
      const command = dispatcher.execute(countryId, "city.create", "PRIVATE_COMMAND_KEY", { name: "PRIVATE_COMMAND_BODY" }).catch(error => error);
      await vi.waitFor(() => expect(dispatcher.runtimeStats().observers).toBe(1), { interval: 5, timeout: 500 });
      expect(dispatcher.runtimeStats().waiters).toBe(1);
      const spy = vi.spyOn(db, "prepare");
      const [a, b] = await Promise.all([readWorldGenerationQueueStats(db), readWorldGenerationQueueStats(db)]);
      expect(a).toEqual(b); expect(a).toMatchObject({ pending: 1, running: 0 });
      expect(spy.mock.calls.filter(([query]) => query.includes("AS pending"))).toHaveLength(1);
      await readWorldGenerationQueueStats(db);
      expect(spy.mock.calls.filter(([query]) => query.includes("AS pending"))).toHaveLength(1);
      spy.mockRestore();
      expect(JSON.stringify({ queue: a, dispatcher: dispatcher.runtimeStats() })).not.toContain(countryId);
      expect(JSON.stringify({ queue: a, dispatcher: dispatcher.runtimeStats() })).not.toContain("PRIVATE_");
      expect(await command).toMatchObject({ code: "GENERATION_PENDING" });
    } finally { await dispatcher.close(); }
    expect(dispatcher.runtimeStats()).toMatchObject({ closed: true, observers: 0, waiters: 0 });
  });
});
