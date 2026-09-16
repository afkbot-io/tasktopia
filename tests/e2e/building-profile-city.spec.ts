import { expect, test } from "@playwright/test";
import { AppService } from "../../src/server/app-service";
import { registerUser } from "../../src/server/auth";
import { createDb } from "../../src/server/db";
import { readActiveBlockLayout } from "../../src/server/world/active-block-layout";
import { BUILDING_PROFILES, type BuildingProfile } from "../../src/shared/building-profiles";
import { taskLink } from "../../src/client/task-navigation";
import type { TaskDto } from "../../src/shared/contracts";

test.use({ viewport: { width: 1920, height: 1440 }, deviceScaleFactor: 1 });

for (const profile of Object.keys(BUILDING_PROFILES) as BuildingProfile[]) {
  test(`real city generation and rendering: ${profile}`, async ({ page }, info) => {
    test.skip(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.E2E_BASE_URL ?? ""), "Own local fixture only");
    test.setTimeout(120_000);
    const database = process.env.E2E_DATABASE_URL ?? "postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test";
    expect(["localhost", "127.0.0.1"]).toContain(new URL(database).hostname);
    const db = await createDb(database, { migrate: false }), service = new AppService(db);
    const { user } = await registerUser(db, { email: `profile-${crypto.randomUUID()}@example.test`, name: "Проверка застройки", password: "password123" });
    const errors: string[] = [], failures: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("response", response => { if (response.status() >= 400 && /\/(api|game-assets)\//.test(response.url())) failures.push(`${response.status()} ${response.url()}`); });
    try {
      await db.prepare("UPDATE countries SET seed=? WHERE id=?").run(123, user.countryId);
      const city = await service.createCity(user.countryId, { name: BUILDING_PROFILES[profile].label, idempotencyKey: crypto.randomUUID() });
      const district = await service.createDistrict(user.countryId, { cityId: city.id, name: "Жилой район", archetype: profile, capacitySp: 100, activate: true, idempotencyKey: crypto.randomUUID() });
      const tasks: TaskDto[] = [];
      for (let i = 0; i < 28; i++) {
        const task = await service.createTask(user.countryId, { cityId: city.id, districtId: district.id, title: `Здание ${i + 1}`, estimate: 1, idempotencyKey: crypto.randomUUID() });
        tasks.push(task);
        for (const status of ["STARTED", "IN_PROGRESS", "TESTING", "COMPLETED"] as const) {
          await service.updateTaskStatus(user.countryId, { taskId: task.id, status, comment: "Подготовка локальной визуальной проверки", idempotencyKey: crypto.randomUUID() });
        }
      }
      const layout = (await readActiveBlockLayout(db, city.id))!;
      expect(layout.placements).toHaveLength(28);
      expect(layout.blocks.length).toBeGreaterThan(1);
      expect(layout.blocks.every(block => block.parameters.buildingProfile === profile)).toBe(true);
      await info.attach("layout", { body: JSON.stringify(layout), contentType: "application/json" });
      expect((await page.request.post("/api/auth/login", { data: { email: user.email, password: "password123" } })).ok()).toBe(true);
      await page.goto(taskLink(user.countryId, tasks[10]!));
      await expect(page.locator("#task-title")).toContainText(tasks[10]!.title);
      await page.getByRole("button", { name: "Закрыть", exact: true }).click();
      const host = page.locator(".world-canvas");
      await expect(host).toHaveAttribute("data-city-scene-commit", "atomic");
      // Center the whole generated city through its normal drag interaction;
      // a task deep link deliberately centers just that task.
      const center = {
        x: (Math.min(...layout.blocks.map(block => block.origin.x)) + Math.max(...layout.blocks.map(block => block.origin.x + block.width))) / 2,
        y: (Math.min(...layout.blocks.map(block => block.origin.y)) + Math.max(...layout.blocks.map(block => block.origin.y + block.height))) / 2,
      };
      const canvas = page.getByLabel("Интерактивная карта города", { exact: true });
      const box = (await canvas.boundingBox())!;
      for (let i = 0; i < 6; i++) {
        const scale = Number(await host.getAttribute("data-render-scale"));
        const dx = (Number(await host.getAttribute("data-camera-world-x")) - center.x) * 8 * scale;
        const dy = (Number(await host.getAttribute("data-camera-world-y")) - center.y) * 8 * scale;
        if (Math.abs(dx) < 3 && Math.abs(dy) < 3) break;
        const fraction = Math.min(1, box.width * .4 / Math.max(1, Math.abs(dx)), box.height * .4 / Math.max(1, Math.abs(dy)));
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + dx * fraction, box.y + box.height / 2 + dy * fraction, { steps: 10 });
        await page.mouse.up();
      }
      await expect(host).toHaveAttribute("data-ground-bake-queue", "0");
      await expect(host).toHaveAttribute("data-world-object-depth-errors", "0");
      await page.screenshot({ path: info.outputPath(`${profile.toLowerCase()}-city.png`) });
      expect(errors).toEqual([]);
      expect(failures).toEqual([]);
    } finally {
      await page.close();
      await db.prepare("DELETE FROM countries WHERE id=?").run(user.countryId);
      await db.prepare("DELETE FROM users WHERE id=?").run(user.id);
      await db.close();
    }
  });
}
