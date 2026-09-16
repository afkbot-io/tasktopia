import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { expect, it, vi } from "vitest";
import { createTestDb } from "../src/server/db";
import { AppService } from "../src/server/app-service";
import { registerRoutes } from "../src/server/routes";

it("serves private development and transport states without loading a planet for an unbuilt city", async () => {
  const db = await createTestDb(), app = Fastify(), service = new AppService(db);
  try {
    await app.register(cookie); await registerRoutes(app, db, service); await app.ready();
    const registered = await app.inject({method:"POST",url:"/api/auth/register",payload:{email:"development-http@example.test",name:"Development",password:"safe-password-123",passwordConfirmation:"safe-password-123",countryName:"Private country",cityName:"Private city"}});
    expect(registered.statusCode).toBeLessThan(300);
    const header = registered.headers["set-cookie"]!;
    const session = (Array.isArray(header) ? header[0]! : header).split(";")[0]!;
    const bootstrap = (await app.inject({url:"/api/bootstrap",headers:{cookie:session}})).json();
    const countryId = bootstrap.country.id;
    const cities = await service.listCities(countryId), cityId = cities[0]!.id;
    const url = `/api/city-development?countryId=${countryId}&cityId=${cityId}`;
    const atlas = vi.spyOn(service,"getPlanetAtlas");
    const response = await app.inject({url,headers:{cookie:session}});
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json().transport).toEqual([{kind:"AIR",state:"NOT_READY",routes:[]},{kind:"RAIL",state:"NOT_READY",routes:[]},{kind:"SEA",state:"NOT_READY",routes:[]}]);
    expect(atlas).not.toHaveBeenCalled();
    expect((await app.inject({url})).statusCode).toBe(401);
    expect((await app.inject({url:`/api/city-development?countryId=${countryId}&cityId=bad`,headers:{cookie:session}})).statusCode).toBe(400);
    expect((await app.inject({url:`/api/city-development?countryId=00000000-0000-4000-8000-000000000001&cityId=${cityId}`,headers:{cookie:session}})).statusCode).toBe(403);
  } finally { vi.restoreAllMocks(); await app.close(); await db.close(); }
});
