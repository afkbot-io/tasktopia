import { expect, test } from "@playwright/test";
import type { CitySceneDto } from "../../src/shared/city-scene-contract";
import { AppService } from "../../src/server/app-service";
import { createDb } from "../../src/server/db";
import type { TaskStatus } from "../../src/shared/contracts";
import { mkdir } from "node:fs/promises";

test("incident response appears and cleans up through real task updates", async ({ page }, info) => {
  test.skip(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.E2E_BASE_URL ?? ""), "Only an isolated local test database");
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  expect((await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } })).ok()).toBe(true);
  const bootstrap = await (await page.request.get("/api/bootstrap")).json();
  expect(bootstrap.country.name).toBe("Тестовая страна");
  const scene = await (await page.request.get(`/api/countries/${bootstrap.country.id}/cities/${bootstrap.initialCity.id}/scene`, {
    headers: { accept: "application/vnd.tasktopia.city-scene+json; version=4" },
  })).json() as CitySceneDto;
  const tasks = scene.chunks.flatMap(c => c.tasks);
  const active = tasks.find(t => t.visualKind === "BUILDING" && t.status === "IN_PROGRESS")!;
  const verifying = tasks.find(t => t.visualKind === "BUILDING" && t.id !== active.id && t.status === "IN_PROGRESS")!;
  expect(active).toBeDefined(); expect(verifying).toBeDefined();
  const db = await createDb(process.env.E2E_DATABASE_URL ?? "postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test", { migrate: false });
  const service = new AppService(db);
  const edit = async (id: string, workItemType: string, status?: TaskStatus) => {
    if (status) await service.updateTaskStatus(bootstrap.country.id, { taskId: id, status,
      ...(status === verifying.status ? { progress: verifying.progress } : {}),
      comment: "Проверка и восстановление локального браузерного сценария", idempotencyKey: crypto.randomUUID() });
    const response = await page.request.patch(`/api/tasks/${id}`, { data: { workItemType, idempotencyKey: crypto.randomUUID() } });
    expect(response.status(), await response.text()).toBe(200);
  };
  await page.goto("/");
  const host = page.locator(".world-canvas");
  await expect(host).toHaveAttribute("data-city-scene-commit", "atomic");
  try {
    await edit(verifying.id, "HOTFIX", "TESTING");
    await expect(host).toHaveAttribute("data-incident-modes", "HOTFIX_VERIFYING");
    await expect(host).toHaveAttribute("data-incident-fires", "0");
    await edit(active.id, "HOTFIX");
    await expect(host).toHaveAttribute("data-incident-modes", "HOTFIX_ACTIVE,HOTFIX_VERIFYING");
    await expect(host).toHaveAttribute("data-incident-fires", "1");
    await expect(host).toHaveAttribute("data-incident-water-jets", "1");
    await mkdir("screenshots/visual-consistency", { recursive: true });
    await page.screenshot({ path: `screenshots/visual-consistency/services-${info.project.name}.png` });
    await edit(active.id, active.workItemType);
    await expect(host).toHaveAttribute("data-incident-fires", "0");
    await expect(host).toHaveAttribute("data-incident-water-jets", "0");
  } finally {
    try {
      await edit(active.id, active.workItemType);
    } finally {
      try { await edit(verifying.id, verifying.workItemType, verifying.status); }
      finally { await db.close(); }
    }
  }
  await expect(host).toHaveAttribute("data-incident-modes", "");
  expect(errors).toEqual([]);
});
