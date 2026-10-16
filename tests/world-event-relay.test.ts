import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type Db } from "../src/server/db";
import { registerUser } from "../src/server/auth";
import { consumeDurableWorldEvents, publishWorldEvent, subscribeToWorldEvents } from "../src/server/world-event-relay";

describe("cross-runtime world event relay", () => {
  let db: Db;
  let subscription: { close(): Promise<void> } | undefined;

  beforeEach(async () => { db = await createTestDb(); });
  afterEach(async () => {
    await subscription?.close();
    await db.close();
  });

  it("notifies the web runtime using a bounded durable event id", async () => {
    let acceptEvent!: (eventId: number) => void;
    const received = new Promise<number>((resolve) => { acceptEvent = resolve; });
    subscription = await subscribeToWorldEvents(
      process.env.TEST_DATABASE_URL ?? "postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test",
      acceptEvent,
    );

    await publishWorldEvent(db, {
      id: 77, countryId: "country", type: "task.created", worldVersion: 3, payload: {}, createdAt: new Date().toISOString(),
    });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      received,
      new Promise<number>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error("world event relay timed out")), 2_000); }),
    ]);
    if (timeout) clearTimeout(timeout);
    expect(result).toBe(77);
  });

  it("replays every durable row when a notification gap skips an event id", async () => {
    const countryId = (await registerUser(db, {
      email: "relay@example.com", name: "Relay", password: "password123",
    })).user.countryId;
    const received: number[] = [];
    subscription = await consumeDurableWorldEvents(
      db,
      process.env.TEST_DATABASE_URL ?? "postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test",
      (event) => { received.push(event.id); },
      60_000,
    );
    const createdAt = new Date().toISOString();
    const first = await db.prepare(`INSERT INTO events (country_id, type, world_version, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?) RETURNING id`).run(countryId, "task.created", 1, "{}", createdAt);
    const second = await db.prepare(`INSERT INTO events (country_id, type, world_version, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?) RETURNING id`).run(countryId, "task.status_changed", 2, "{}", createdAt);
    const firstId = Number(first.rows[0]?.id);
    const secondId = Number(second.rows[0]?.id);

    await publishWorldEvent(db, {
      id: secondId, countryId, type: "task.status_changed", worldVersion: 2, payload: {}, createdAt,
    });
    await vi.waitFor(() => expect(received).toEqual([firstId, secondId]), { timeout: 2_000 });
  });

  it.each([true, false])("delivers a later commit with an older event id from another country (notification=%s)", async notification => {
    const countryA = (await registerUser(db, { email: "relay-a@example.com", name: "Country A", password: "password123" })).user.countryId;
    const countryB = (await registerUser(db, { email: "relay-b@example.com", name: "Country B", password: "password123" })).user.countryId;
    const received: number[] = [];
    subscription = await consumeDurableWorldEvents(db, process.env.TEST_DATABASE_URL!, event => { received.push(event.id); }, 20);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let inserted!: (id: number) => void;
    const insertedSignal = new Promise<number>(resolve => { inserted = resolve; });
    const createdAt = new Date().toISOString();
    const oldCommit = db.transaction(async () => {
      const result = await db.prepare(`INSERT INTO events(country_id,type,world_version,payload_json,created_at)
        VALUES(?,'task.comment_added',1,'{}',?) RETURNING id`).run(countryA, createdAt);
      inserted(Number(result.rows[0]?.id));
      await gate;
    });
    const firstId = await insertedSignal;
    const result = await db.prepare(`INSERT INTO events(country_id,type,world_version,payload_json,created_at)
      VALUES(?,'task.comment_added',1,'{}',?) RETURNING id`).run(countryB, createdAt);
    const secondId = Number(result.rows[0]?.id);
    expect(secondId).toBeGreaterThan(firstId);
    try {
      await publishWorldEvent(db, { id: secondId, countryId: countryB, type: "task.comment_added", worldVersion: 1, payload: {}, createdAt });
      await vi.waitFor(() => expect(received).toEqual([secondId]), { timeout: 1_000, interval: 10 });
    } finally { release(); await oldCommit; }
    if (notification) await publishWorldEvent(db, { id: firstId, countryId: countryA, type: "task.comment_added", worldVersion: 1, payload: {}, createdAt });
    await vi.waitFor(() => expect(received).toEqual([secondId, firstId]), { timeout: 500, interval: 10 });
  });

  it("keeps historical events as the startup baseline for every country", async () => {
    const countryIds = await Promise.all(["a", "b"].map(async suffix => (await registerUser(db,
      { email: `baseline-${suffix}@example.com`, name: `Baseline ${suffix}`, password: "password123" })).user.countryId));
    const createdAt = new Date().toISOString();
    const insert = async (countryId: string, version: number) => Number((await db.prepare(`INSERT INTO events(country_id,type,world_version,payload_json,created_at)
      VALUES(?,'task.comment_added',?,'{}',?) RETURNING id`).run(countryId, version, createdAt)).rows[0]?.id);
    const history = await Promise.all(countryIds.map(id => insert(id, 1)));
    const received: number[] = [];
    subscription = await consumeDurableWorldEvents(db, process.env.TEST_DATABASE_URL!, event => { received.push(event.id); }, 20);
    await publishWorldEvent(db, { id: history[0]!, countryId: countryIds[0]!, type: "task.comment_added", worldVersion: 1, payload: {}, createdAt });
    const fresh = await Promise.all(countryIds.map(id => insert(id, 2)));
    await vi.waitFor(() => expect([...received].sort((a, b) => a - b)).toEqual([...fresh].sort((a, b) => a - b)), { timeout: 1_000, interval: 10 });
    expect(received.some(id => history.includes(id))).toBe(false);
  });
});
