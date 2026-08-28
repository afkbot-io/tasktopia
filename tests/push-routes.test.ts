import fastifyCookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser, SESSION_COOKIE } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import { registerRoutes } from "../src/server/routes";

const subscription = {
  endpoint: "https://updates.push.services.mozilla.com/wpush/v2/route-example",
  expirationTime: null,
  keys: {
    p256dh: "BOr5I6ZBqj9iU2DKzZL6SXjZ1hP0vH2_aCNJjvW7f3OYPxLkbZJf0dQ5m2LFN5BkjP1KrMa_XPpxdtEbYqCVkX0",
    auth: "MDEyMzQ1Njc4OWFiY2RlZg",
  },
};

describe("push subscription HTTP boundary", { timeout: 30_000 }, () => {
  let db: Db;
  let app: FastifyInstance;
  let cookie: string;

  beforeEach(async () => {
    db = await createTestDb();
    app = Fastify();
    await app.register(fastifyCookie);
    await registerRoutes(app, db, new AppService(db), { pushPublicKey: subscription.keys.p256dh });
    const registered = await registerUser(db, { email: "push@example.test", name: "Push User", password: "safe-password-123" });
    cookie = `${SESSION_COOKIE}=${registered.session}`;
    await app.ready();
  });

  afterEach(async () => { await app.close(); await db.close(); });

  it("requires authentication and exposes readiness without subscription secrets", async () => {
    expect((await app.inject({ method: "GET", url: "/api/push/status" })).statusCode).toBe(401);
    const response = await app.inject({ method: "GET", url: "/api/push/status", headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ configured: true, publicKey: subscription.keys.p256dh, subscribed: false });
    expect(response.body).not.toContain("endpoint");
  });

  it("creates idempotently, validates and removes only the caller subscription", async () => {
    for (let index = 0; index < 2; index += 1) {
      const response = await app.inject({ method: "POST", url: "/api/push/subscriptions", headers: { cookie }, payload: subscription });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({ subscribed: true });
    }
    expect(await db.prepare("SELECT COUNT(*)::integer AS count FROM push_subscriptions_v1").get()).toMatchObject({ count: 1 });
    expect((await app.inject({ method: "POST", url: "/api/push/subscriptions", headers: { cookie }, payload: { ...subscription, endpoint: "http://unsafe.test" } })).statusCode).toBe(400);
    const removed = await app.inject({ method: "DELETE", url: "/api/push/subscriptions", headers: { cookie }, payload: { endpoint: subscription.endpoint } });
    expect(removed.json()).toEqual({ subscribed: false });
    expect(await db.prepare("SELECT 1 FROM push_subscriptions_v1").get()).toBeUndefined();
  });

  it("does not allow one browser endpoint to cross account ownership", async () => {
    expect((await app.inject({ method: "POST", url: "/api/push/subscriptions", headers: { cookie }, payload: subscription })).statusCode).toBe(201);
    const foreign = await registerUser(db, { email: "foreign-push@example.test", name: "Foreign Push", password: "safe-password-123" });
    const response = await app.inject({ method: "POST", url: "/api/push/subscriptions", headers: { cookie: `${SESSION_COOKIE}=${foreign.session}` }, payload: subscription });
    expect(response.statusCode).toBe(409);
    expect(response.body).not.toContain(subscription.endpoint);
  });
});
