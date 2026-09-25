import { expect, test } from "@playwright/test";
import { AppService } from "../../src/server/app-service";
import { registerUser } from "../../src/server/auth";
import { createDb } from "../../src/server/db";
import { readActiveBlockLayout } from "../../src/server/world/active-block-layout";
import { taskLink } from "../../src/client/task-navigation";
import type { TaskDto } from "../../src/shared/contracts";

test("moving a station updates its approach on the open map while retaining the corridor", async ({ page }, info) => {
  test.skip(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.E2E_BASE_URL ?? ""), "Isolated local server only");
  test.setTimeout(90_000);
  const database = process.env.E2E_DATABASE_URL ?? "postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test";
  expect(["127.0.0.1", "localhost"]).toContain(new URL(database).hostname);
  const db = await createDb(database, { migrate: false }), service = new AppService(db);
  const { user } = await registerUser(db, { email: `rail-transfer-${crypto.randomUUID()}@example.test`, name: "Rail QA", password: "password123" });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    const country = user.countryId;
    await db.prepare("UPDATE countries SET seed=? WHERE id=?").run(424242, country);
    const city = await service.createCity(country, { name: "Перенос вокзала", idempotencyKey: crypto.randomUUID() });
    let station: TaskDto | undefined;
    for (let i = 0; i < 12 && !station; i++) {
      const district = await service.createDistrict(country, { cityId: city.id, name: `Район ${i}`, activate: false, idempotencyKey: crypto.randomUUID() });
      const task = await service.createTask(country, { cityId: city.id, districtId: district.id, title: `Здание ${i}`, estimate: 1, idempotencyKey: crypto.randomUUID() });
      if (task.serviceRole === "RAILWAY") station = task;
    }
    if (!station) {
      const layout = (await readActiveBlockLayout(db, city.id))!;
      const block = layout.blocks.find(b => Object.values(b.parameters.slotRoles ?? {}).includes("RAILWAY"))!;
      expect(block).toBeDefined();
      const districtId = layout.districtLayouts.find(d => d.id === block.districtLayoutId)!.districtId;
      station = await service.createTask(country, { cityId: city.id, districtId, title: "Вокзал", estimate: 1, idempotencyKey: crypto.randomUUID() });
    }
    expect(station.serviceRole).toBe("RAILWAY");
    await service.activateDistrict(country, station.districtId, crypto.randomUUID());
    for (const status of ["STARTED", "IN_PROGRESS", "TESTING", "COMPLETED"] as const) {
      await service.updateTaskStatus(country, { taskId: station.id, status, comment: "QA setup", idempotencyKey: crypto.randomUUID() });
    }
    const destination = await service.createDistrict(country, { cityId: city.id, name: "Новый район вокзала", activate: false, idempotencyKey: crypto.randomUUID() });
    const before = await service.getCityScene(country, city.id);
    expect(before.railway).toBeTruthy();
    expect((await page.request.post("/api/auth/login", { data: { email: user.email, password: "password123" } })).ok()).toBe(true);
    let navigations = 0;
    page.on("request", request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations++; });
    await page.goto(taskLink(country, station));
    await expect(page.locator("#task-title")).toContainText(station.title);
    await page.getByRole("button", { name: "Закрыть", exact: true }).click();
    const host = page.locator(".world-canvas");
    await expect(host).toHaveAttribute("data-city-scene-commit", "atomic");
    const response = await page.request.post(`/api/tasks/${station.id}/transfer`, {
      data: { targetDistrictId: destination.id, idempotencyKey: crypto.randomUUID() },
    });
    expect(response.status(), await response.text()).toBe(200);
    const moved = await response.json() as TaskDto;
    const after = await service.getCityScene(country, city.id);
    expect(after.railway!.from).toEqual(before.railway!.from);
    expect(after.railway!.to).toEqual(before.railway!.to);
    expect(after.railway!.platform).toEqual(before.railway!.platform);
    expect(after.railway!.access).not.toEqual(before.railway!.access);
    expect(moved.accessPath).toContainEqual(after.railway!.access[0]);
    expect(after.chunks.flatMap(chunk => chunk.worldFeatures)
      .filter(feature => feature.siteMarker?.kind === "RELOCATED")).toEqual([]);
    await expect.poll(async () => JSON.parse((await host.getAttribute("data-city-railway-geometry")) ?? "null")).toEqual({
      from: after.railway!.from, to: after.railway!.to, platform: after.railway!.platform, accessLength: after.railway!.access.length,
    });
    // One station cannot invent a departure without another ready endpoint.
    await expect(host).toHaveAttribute("data-city-train", "none");
    await page.getByLabel("Поиск здания по номеру или названию").fill(String(station.taskNumber));
    await page.getByRole("option").filter({ hasText: `#${station.taskNumber}` }).click();
    await expect(page.locator("#task-title")).toContainText(station.title);
    await page.getByRole("button", { name: "Закрыть", exact: true }).click();
    await page.screenshot({ path: info.outputPath("moved-station.png") });
    expect(navigations).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await db.prepare("DELETE FROM countries WHERE id=?").run(user.countryId);
    await db.prepare("DELETE FROM users WHERE id=?").run(user.id);
    await db.close();
  }
});
