import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "../src/server/db";
import { publishWorldEvent, subscribeToWorldEvents } from "../src/server/world-event-relay";

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
});
