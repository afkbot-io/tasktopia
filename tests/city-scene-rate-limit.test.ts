import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { expect, it } from "vitest";
import { createTestDb } from "../src/server/db";
import { config } from "../src/server/config";
import { AppService } from "../src/server/app-service";
import { registerRoutes } from "../src/server/routes";

it("keeps the production scene limit at thirty unless explicitly configured", () => {
  expect(config.citySceneRateLimitMax).toBe(Number(process.env.CITY_SCENE_RATE_LIMIT_MAX ?? 30));
});
it.each(["/api/cities/00000000-0000-4000-8000-000000000001/scene",
  "/api/countries/00000000-0000-4000-8000-000000000002/cities/00000000-0000-4000-8000-000000000001/scene"])(
  "enforces the configured limit without bypassing authentication: %s", async url => {
    const db = await createTestDb(), app = Fastify(), original = config.citySceneRateLimitMax;
    try {
      config.citySceneRateLimitMax = 2;
      await app.register(cookie); await app.register(rateLimit, { max: 5000, timeWindow: "1 minute" });
      await registerRoutes(app, db, new AppService(db)); await app.ready();
      for (let i = 0; i < 2; i++) expect((await app.inject({ url })).statusCode).toBe(401);
      const limited = await app.inject({ url });
      expect(limited.statusCode).toBe(429);
      expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    } finally { config.citySceneRateLimitMax = original; await app.close(); await db.close(); }
  });
