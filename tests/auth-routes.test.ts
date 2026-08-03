import fastifyCookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { createDb, type Db } from "../src/server/db";
import { registerRoutes } from "../src/server/routes";

describe("authentication HTTP boundary", () => {
  let db: Db;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = createDb(":memory:");
    app = Fastify();
    await app.register(fastifyCookie);
    registerRoutes(app, db, new AppService(db));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("registers, restores the country session, logs out, and logs in again", async () => {
    const registered = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "mayor@example.test", name: "Test Mayor", password: "safe-password-123" },
    });
    expect(registered.statusCode).toBe(200);
    const setCookie = registered.headers["set-cookie"]!;
    const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;

    const bootstrap = await app.inject({ method: "GET", url: "/api/bootstrap", headers: { cookie } });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json()).toMatchObject({ user: { email: "mayor@example.test" }, countryRole: "OWNER" });

    const loggedOut = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } });
    expect(loggedOut.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/bootstrap", headers: { cookie } })).statusCode).toBe(401);

    const loggedIn = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "MAYOR@example.test", password: "safe-password-123" },
    });
    expect(loggedIn.statusCode).toBe(200);
    expect(loggedIn.headers["set-cookie"]).toBeDefined();
  });

  it("returns a clear conflict instead of Bad Request or 500 for an existing email", async () => {
    const payload = { email: "duplicate@example.test", name: "First Mayor", password: "safe-password-123" };
    expect((await app.inject({ method: "POST", url: "/api/auth/register", payload })).statusCode).toBe(200);

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { ...payload, name: "Second Mayor" },
    });

    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toEqual({
      error: "CONFLICT",
      message: "Аккаунт с таким email уже существует",
    });
  });

  it("returns understandable validation and credential errors", async () => {
    const malformed = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "not-an-email", name: "X", password: "short" },
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toMatchObject({ error: "INVALID_INPUT", message: "Введите корректный email" });

    const invalidLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "nobody@example.test", password: "safe-password-123" },
    });
    expect(invalidLogin.statusCode).toBe(401);
    expect(invalidLogin.json()).toMatchObject({ error: "UNAUTHENTICATED", message: "Неверный email или пароль" });
  });
});

