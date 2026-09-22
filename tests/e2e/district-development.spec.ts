import { expect, test } from "@playwright/test";
import { AppService } from "../../src/server/app-service";
import { createDb } from "../../src/server/db";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

test("active district is visible in city mode and empty plans never reserve land", async ({ page }, info) => {
  test.skip(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.E2E_BASE_URL ?? ""), "Local isolated fixture only");
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  expect((await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } })).ok()).toBe(true);
  const bootstrap = await (await page.request.get("/api/bootstrap")).json();
  expect(bootstrap.country.name).toBe("Тестовая страна");
  const db = await createDb(process.env.E2E_DATABASE_URL ?? "postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test", { migrate: false });
  const service = new AppService(db);
  const districts = await service.listDistricts(bootstrap.country.id, bootstrap.initialCity.id);
  const active = districts.find(d => d.status === "ACTIVE")!;
  const tokenResponse = await page.request.post("/api/tokens", { data: { name: "District development QA", scopes: ["districts:write"], expiresInDays: 30 } });
  expect(tokenResponse.ok()).toBe(true);
  const token = await tokenResponse.json();
  const client = new Client({ name: "district-development-qa", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", process.env.E2E_BASE_URL), {
    requestInit: { headers: { Authorization: `Bearer ${token.token}` } },
  }));
  let empty: Awaited<ReturnType<typeof service.createDistrict>> | undefined;
  try {
    await page.goto("/");
    await page.getByRole("navigation", { name: "Уровень карты" }).getByRole("button", { name: "Город", exact: true }).click();
    const host = page.locator(".world-canvas");
    await expect(host).toHaveAttribute("data-city-scene-commit", "atomic");
    await expect(host).toHaveAttribute("data-district-boundary-visible", "false");
    await expect.poll(async () => Number(await host.getAttribute("data-development-fences"))).toBeGreaterThan(0);
    expect(Number(await host.getAttribute("data-development-fences"))).toBeLessThanOrEqual(48);
    await page.screenshot({ path: info.outputPath("active-district.png") });
    await expect.poll(async () => Number(await host.getAttribute("data-construction-workers"))).toBeGreaterThan(0);
    expect(Number(await host.getAttribute("data-construction-workers"))).toBeLessThanOrEqual(8);
    expect(Number(await host.getAttribute("data-construction-materials"))).toBeLessThanOrEqual(16);
    // Reduced motion must work in a populated active district, not only an empty plan.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await page.getByRole("navigation", { name: "Уровень карты" }).getByRole("button", { name: "Город", exact: true }).click();
    await expect(host).toHaveAttribute("data-city-scene-commit", "atomic");
    await expect(host).toHaveAttribute("data-construction-workers", "0");
    await expect.poll(async () => Number(await host.getAttribute("data-development-fences"))).toBeGreaterThan(0);
    await page.screenshot({ path: info.outputPath("active-district-static.png") });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.reload();
    await page.getByRole("navigation", { name: "Уровень карты" }).getByRole("button", { name: "Город", exact: true }).click();
    await expect.poll(async () => Number(await host.getAttribute("data-construction-workers"))).toBeGreaterThan(0);
    const bakes = await host.getAttribute("data-ground-rebuilds");
    await page.getByRole("button", { name: "Районы", exact: true }).click();
    await page.getByRole("button", { name: "Город", exact: true }).click();
    expect(await host.getAttribute("data-ground-rebuilds")).toBe(bakes);
    empty = await service.createDistrict(bootstrap.country.id, { cityId: bootstrap.initialCity.id,
      name: `Будущий район ${crypto.randomUUID().slice(0, 8)}`, activate: false, idempotencyKey: crypto.randomUUID() });
    expect(empty.cells).toEqual([]);
    expect(empty.lots).toEqual([]);
    await page.reload();
    await page.getByRole("navigation", { name: "Уровень карты" }).getByRole("button", { name: "Город", exact: true }).click();
    const notice = page.getByRole("navigation", { name: "Районы без участков" });
    await expect(notice).toContainText(empty.name);
    await notice.getByRole("button", { name: new RegExp(empty.name) }).click();
    await expect(page.locator(".city-directory")).toContainText(empty.name);
    await page.keyboard.press("Escape");
    const activated = await client.callTool({ name: "district.activate", arguments: {
      countryId: bootstrap.country.id, districtId: empty.id, idempotencyKey: crypto.randomUUID(),
    } });
    expect(activated.isError).not.toBe(true);
    await expect(host).toHaveAttribute("data-development-fences", "0", { timeout: 15_000 });
    await expect(notice).toContainText("Подготовка района");
    await expect(host).toHaveAttribute("data-construction-workers", "0");
    await expect(host).toHaveAttribute("data-construction-materials", "0");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await page.getByRole("navigation", { name: "Уровень карты" }).getByRole("button", { name: "Город", exact: true }).click();
    await expect(notice).toContainText(empty.name);
    expect(errors).toEqual([]);
  } finally {
    await service.activateDistrict(bootstrap.country.id, active.id, crypto.randomUUID());
    if (empty) await service.deleteDistrict(bootstrap.country.id, { districtId: empty.id, confirmName: empty.name, idempotencyKey: crypto.randomUUID() });
    await client.close();
    await page.request.delete(`/api/tokens/${token.id}`);
    await db.close();
  }
});
