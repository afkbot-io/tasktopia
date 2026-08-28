import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import { runPushDeliveryCycle } from "../src/server/push-delivery";
import type { PushGateway } from "../src/server/push-gateway";
import { savePushSubscription } from "../src/server/push-subscriptions";
import type { BrowserPushSubscription } from "../src/server/push-subscriptions";

const subscription = {
  endpoint: "https://updates.push.services.mozilla.com/wpush/v2/delivery-example",
  expirationTime: null,
  keys: {
    p256dh: "BOr5I6ZBqj9iU2DKzZL6SXjZ1hP0vH2_aCNJjvW7f3OYPxLkbZJf0dQ5m2LFN5BkjP1KrMa_XPpxdtEbYqCVkX0",
    auth: "MDEyMzQ1Njc4OWFiY2RlZg",
  },
};

describe("durable push delivery", { timeout: 60_000 }, () => {
  let db: Db;
  let service: AppService;
  let userId: string;
  let countryId: string;
  let taskId: string;

  beforeEach(async () => {
    db = await createTestDb();
    service = new AppService(db);
    const account = await registerUser(db, { email: "delivery@example.test", name: "Delivery", password: "safe-password-123" });
    ({ id: userId, countryId } = account.user);
    await savePushSubscription(db, userId, subscription);
    const city = await service.createCity(countryId, { name: "Push City", idempotencyKey: "push-city" });
    const district = await service.createDistrict(countryId, { cityId: city.id, name: "Push District", activate: true, idempotencyKey: "push-district" });
    taskId = (await service.createTask(countryId, { cityId: city.id, districtId: district.id, title: "Push task", estimate: 1, idempotencyKey: "push-task" })).id;
  });

  afterEach(async () => { await db.close(); });

  it("sends a minimal event once and deduplicates repeat cycles", async () => {
    const send = vi.fn(async (...args: [BrowserPushSubscription, string]) => {
      void args;
      return { statusCode: 201 };
    });
    const gateway: PushGateway = { send };
    await runPushDeliveryCycle(db, gateway);
    await runPushDeliveryCycle(db, gateway);
    expect(send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(send.mock.calls[0]![1]);
    expect(payload).toMatchObject({ body: expect.stringContaining("Push City"), url: expect.stringMatching(/^\/task\/\d+$/), tag: expect.stringMatching(/^event-/) });
    expect(payload).not.toHaveProperty("countryId");
    expect(await db.prepare("SELECT status, attempts FROM push_deliveries_v1").get()).toMatchObject({ status: "SENT", attempts: 1 });
  });

  it("removes a terminal endpoint without affecting the canonical task mutation", async () => {
    const gateway: PushGateway = { send: vi.fn(async () => { throw Object.assign(new Error("gone"), { statusCode: 410 }); }) };
    await runPushDeliveryCycle(db, gateway);
    expect(await db.prepare("SELECT 1 FROM push_subscriptions_v1").get()).toBeUndefined();
    expect(await db.prepare("SELECT status, last_error_code FROM push_deliveries_v1").get()).toMatchObject({ status: "FAILED", last_error_code: "GONE" });
    expect(await service.getTask(countryId, taskId)).toMatchObject({ id: taskId, title: "Push task" });
  });

  it("does not deliver after country membership is revoked", async () => {
    await db.prepare("DELETE FROM country_members WHERE country_id=? AND user_id=?").run(countryId, userId);
    const send = vi.fn(async () => ({ statusCode: 201 }));
    await runPushDeliveryCycle(db, { send });
    expect(send).not.toHaveBeenCalled();
  });

  it("bounds transient retries and does not create duplicate delivery rows", async () => {
    const send = vi.fn(async (...args: [BrowserPushSubscription, string]) => {
      void args;
      throw Object.assign(new Error("provider unavailable"), { statusCode: 503 });
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await runPushDeliveryCycle(db, { send });
      await db.prepare("UPDATE push_deliveries_v1 SET next_attempt_at=now() WHERE status='RETRY'").run();
    }
    expect(send).toHaveBeenCalledTimes(3);
    expect(await db.prepare("SELECT COUNT(*)::integer AS count FROM push_deliveries_v1").get()).toMatchObject({ count: 1 });
    expect(await db.prepare("SELECT status, attempts, last_error_code FROM push_deliveries_v1").get())
      .toMatchObject({ status: "FAILED", attempts: 3, last_error_code: "HTTP_503" });
  });
});
