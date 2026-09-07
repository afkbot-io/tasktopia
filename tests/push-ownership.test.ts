import { afterEach, describe, expect, it } from "vitest";
import { registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import { savePushSubscription } from "../src/server/push-subscriptions";

describe("atomic push endpoint ownership", () => {
  let db: Db;
  afterEach(async () => { await db?.close(); });
  it("allows exactly one owner during simultaneous first registration without replacing that owner's encryption keys", async () => {
    db = await createTestDb();
    const a = await registerUser(db, { email: "push-race-a@example.test", name: "User A", password: "password123" });
    const b = await registerUser(db, { email: "push-race-b@example.test", name: "User B", password: "password123" });
    const subscription = { endpoint: "https://fcm.googleapis.com/wp/ownership-race", expirationTime: null,
      keys: { p256dh: "BOr5I6ZBqj9iU2DKzZL6SXjZ1hP0vH2_aCNJjvW7f3OYPxLkbZJf0dQ5m2LFN5BkjP1KrMa_XPpxdtEbYqCVkX0", auth: "MDEyMzQ1Njc4OWFiY2RlZg" } };
    const alternative = { ...subscription, keys: { ...subscription.keys, auth: Buffer.alloc(16, 7).toString("base64url") } };
    // Coordinate the old read-before-write race, without mocking SQL or its
    // result. A correct one-statement implementation never enters this seam.
    const original = db.prepare.bind(db); let readers = 0; let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    db.prepare = query => {
      const statement = original(query);
      if (!query.startsWith("SELECT user_id FROM push_subscriptions_v1")) return statement;
      return { ...statement, get: async (...params) => {
        const result = await statement.get(...params); readers++; if (readers === 2) release(); await barrier;
        return result as never;
      } };
    };
    const outcomes = await Promise.allSettled([
      savePushSubscription(db, a.user.id, subscription), savePushSubscription(db, b.user.id, alternative),
    ]);
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find(result => result.status === "rejected")).toMatchObject({ reason: { message: "PUSH_ENDPOINT_OWNED" } });
    const winner = outcomes[0]!.status === "fulfilled" ? a : b;
    const expectedKeys = winner === a ? subscription.keys : alternative.keys;
    expect(await db.prepare("SELECT user_id, p256dh, auth FROM push_subscriptions_v1").get())
      .toMatchObject({ user_id: winner.user.id, ...expectedKeys });
  }, 30_000);
});
