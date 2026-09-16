import { expect, test } from "@playwright/test";
import { AppService } from "../../src/server/app-service";
import { createCountry, registerUser } from "../../src/server/auth";
import { createDb } from "../../src/server/db";
import { taskLink } from "../../src/client/task-navigation";

test("renders the persisted sea profile continuously when panning beyond city chunks", async ({ page }, info) => {
  test.skip(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.E2E_BASE_URL ?? ""), "Own local fixture only");
  const database = process.env.E2E_DATABASE_URL ?? "postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test";
  expect(["localhost", "127.0.0.1"]).toContain(new URL(database).hostname);
  const db = await createDb(database, { migrate: false }), service = new AppService(db);
  const { user } = await registerUser(db, { email: `coast-${crypto.randomUUID()}@example.test`, name: "Берег", password: "password123" });
  let countryId: string | undefined;
  const errors: string[] = [], failures: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => { if (response.status() >= 400 && /\/(api|game-assets)\//.test(response.url())) failures.push(`${response.status()} ${response.url()}`); });
  try {
    const profile = { version: 1, kind: "EAST_COAST", coastX: 128 } as const;
    countryId = await createCountry(db, user.id, "Проверка морского берега", profile);
    await db.prepare("UPDATE countries SET seed=? WHERE id=?").run(123, countryId);
    const city = await service.createCity(countryId, { name: "Приморский город", idempotencyKey: "city" });
    const district = await service.createDistrict(countryId, { cityId: city.id, name: "Первый район", activate: true, idempotencyKey: "district" });
    const task = await service.createTask(countryId, { cityId: city.id, districtId: district.id, title: "Дом у моря", estimate: 1, idempotencyKey: "task" });
    expect((await page.request.post("/api/auth/login", { data: { email: user.email, password: "password123" } })).ok()).toBe(true);
    const bootstrap = await (await page.request.get("/api/bootstrap")).json();
    expect(bootstrap.worldManifest.terrainProfile).toEqual(profile);
    await page.goto(taskLink(countryId, task));
    await expect(page.locator("#task-title")).toContainText(task.title);
    await page.getByRole("button", { name: "Закрыть", exact: true }).click();
    const host = page.locator(".world-canvas");
    await expect(host).toHaveAttribute("data-city-scene-commit", "atomic");
    const box = (await page.getByLabel("Интерактивная карта города", { exact: true }).boundingBox())!;
    const target = { x: profile.coastX, y: city.center.y };
    for (let i = 0; i < 12; i++) {
      const scale = Number(await host.getAttribute("data-render-scale"));
      const dx = (Number(await host.getAttribute("data-camera-world-x")) - target.x) * 8 * scale;
      const dy = (Number(await host.getAttribute("data-camera-world-y")) - target.y) * 8 * scale;
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) break;
      const fraction = Math.min(1, box.width * .4 / Math.max(1, Math.abs(dx)), box.height * .4 / Math.max(1, Math.abs(dy)));
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + dx * fraction, box.y + box.height / 2 + dy * fraction, { steps: 10 });
      await page.mouse.up();
    }
    await expect.poll(async () => Math.abs(Number(await host.getAttribute("data-camera-world-x")) - target.x)).toBeLessThan(1);
    await expect(host).toHaveAttribute("data-ground-bake-queue", "0");
    await page.screenshot({ path: info.outputPath("coastal-world.png") });
    expect(errors).toEqual([]);
    expect(failures).toEqual([]);
  } finally {
    await page.close();
    if (countryId) await db.prepare("DELETE FROM countries WHERE id=?").run(countryId);
    await db.prepare("DELETE FROM countries WHERE id=?").run(user.countryId);
    await db.prepare("DELETE FROM users WHERE id=?").run(user.id);
    await db.close();
  }
});
