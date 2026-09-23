import { openMapCity } from "./map-navigation";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { expect, test } from "@playwright/test";
import { createDb } from "../../src/server/db";
import { AppService } from "../../src/server/app-service";
test("attention outlines assigned buildings without camera or terrain changes", async ({ page }, info) => {
  test.skip(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.E2E_BASE_URL ?? ""), "Local isolated fixture only");
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  expect((await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } })).ok()).toBe(true);
  const bootstrap = await (await page.request.get("/api/bootstrap")).json();
  expect(bootstrap.country.name).toBe("Тестовая страна");
  const db = await createDb(process.env.E2E_DATABASE_URL ?? "postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test", { migrate: false });
  const service = new AppService(db);
  const tasks = await service.listTasks(bootstrap.country.id);
  const task = tasks.find(t => t.status === "COMPLETED")!;
  const dependent = tasks.find(t => t.cityId === task.cityId && t.id !== task.id && t.status !== "COMPLETED")!;
  const alreadyLinked = dependent.dependencies?.some(d => d.id === task.id);
  expect(task).toBeTruthy();
  const tokenResponse = await page.request.post("/api/tokens", { data: { name: "Attention live QA", scopes: ["tasks:write"], expiresInDays: 30 } });
  expect(tokenResponse.ok()).toBe(true);
  const token = await tokenResponse.json();
  const client = new Client({ name: "attention-live-qa", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", process.env.E2E_BASE_URL), { requestInit: { headers: { Authorization: `Bearer ${token.token}` } } }));

  try {
    await service.assignTask(bootstrap.country.id, { taskId: task.id, assigneeUserId: bootstrap.user.id, idempotencyKey: crypto.randomUUID() });
    if (!alreadyLinked) await service.addTaskDependency(bootstrap.country.id, { taskId: dependent.id, dependsOnTaskId: task.id, idempotencyKey: crypto.randomUUID() });
    await page.goto("/");
    await openMapCity(page);
    await page.locator(".game-popover > summary").filter({hasText:"Фильтры"}).click();
    await expect(page.getByRole("navigation", { name: "Подсветка построек" })).toBeVisible();
    await expect(page.locator(".app-header").getByRole("navigation", { name: "Подсветка построек" })).toBeVisible();
    await expect(page.locator(".app-header").getByRole("button", { name: "Развитие города" })).toBeVisible();
    const host = page.locator(".world-canvas");
    await expect(host).toHaveAttribute("data-city-scene-commit", "atomic");
    const before = await host.evaluate(el => [el.getAttribute("data-camera-world-x"), el.getAttribute("data-camera-world-y"), el.getAttribute("data-ground-rebuilds")]);
    const menu = page.getByRole("navigation", { name: "Подсветка построек" });
    let requests = 0;
    page.on("request", req => { if (req.url().includes("/api/map-attention?")) requests++; });
    await menu.getByRole("button", { name: "Мои объекты", exact: true }).click();
    await expect.poll(async () => Number(await host.getAttribute("data-attention-tasks"))).toBeGreaterThan(0);
    await page.screenshot({ path: info.outputPath("mine.png") });
    const unassigned = await client.callTool({ name: "task.assign", arguments: { countryId: bootstrap.country.id, taskId: task.id, assigneeEmail: null, idempotencyKey: crypto.randomUUID() } });
    expect(unassigned.isError).not.toBe(true);
    await expect(host).toHaveAttribute("data-attention-tasks", "0");
    const assigned = await client.callTool({ name: "task.assign", arguments: { countryId: bootstrap.country.id, taskId: task.id, assigneeEmail: "demo@tasktopia.local", idempotencyKey: crypto.randomUUID() } });
    expect(assigned.isError).not.toBe(true);
    await expect.poll(async () => Number(await host.getAttribute("data-attention-tasks"))).toBeGreaterThan(0);
    const loadedRequests = requests;
    await menu.getByRole("button", { name: "Приёмка", exact: true }).click();
    await expect(menu.getByRole("button", { name: "Приёмка", exact: true })).toHaveAttribute("aria-pressed", "true");
    await menu.getByRole("button", { name: "Мои объекты", exact: true }).click();
    await expect.poll(async () => Number(await host.getAttribute("data-attention-tasks"))).toBeGreaterThan(0);
    expect(requests).toBe(loadedRequests);
    expect(await host.evaluate(el => [el.getAttribute("data-camera-world-x"), el.getAttribute("data-camera-world-y"), el.getAttribute("data-ground-rebuilds")])).toEqual(before);
    await menu.getByRole("button", { name: "Мои объекты", exact: true }).click();
    await expect(host).toHaveAttribute("data-attention-tasks", "0");
    const offRequests = requests;
    await menu.getByRole("button", { name: "Мои объекты", exact: true }).click();
    await expect.poll(async () => Number(await host.getAttribute("data-attention-tasks"))).toBeGreaterThan(0);
    expect(requests).toBe(offRequests);
    await menu.getByRole("button", { name: "Мои объекты", exact: true }).click();
    await page.goto(`/task/${dependent.taskNumber}?countryId=${bootstrap.country.id}&taskId=${dependent.id}`);
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Показать зависимости на карте" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("complementary", { name: "Зависимости выбранной задачи" })).toContainText(`#${task.taskNumber}`);
    await expect.poll(async () => Number(await host.getAttribute("data-dependency-edges"))).toBeGreaterThan(0);
    await page.screenshot({ path: info.outputPath("dependencies.png") });
    await page.getByRole("button", { name: "Скрыть зависимости" }).click();
    await expect(host).toHaveAttribute("data-dependency-edges", "0");
    expect(errors).toEqual([]);
  } finally {
    if (!alreadyLinked) await service.removeTaskDependency(bootstrap.country.id, { taskId: dependent.id, dependsOnTaskId: task.id, idempotencyKey: crypto.randomUUID() });
    await service.assignTask(bootstrap.country.id, { taskId: task.id, assigneeUserId: task.assignee?.id ?? null, idempotencyKey: crypto.randomUUID() });
    await client.close();
    await page.request.delete(`/api/tokens/${token.id}`);
    await db.close();
  }
});

test("overdue attention advances with time and retry recovers metadata", async ({ page }) => {
  test.skip(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.E2E_BASE_URL ?? ""), "Local isolated fixture only");
  await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } });
  const bootstrap = await (await page.request.get("/api/bootstrap")).json();
  expect(bootstrap.country.name).toBe("Тестовая страна");
  await page.clock.install({ time: new Date() });
  const db = await createDb(process.env.E2E_DATABASE_URL ?? "postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test", { migrate: false });
  const service = new AppService(db);
  const task = (await service.listTasks(bootstrap.country.id)).find(t => t.status !== "COMPLETED")!;
  try {
    await service.updateTaskFields(bootstrap.country.id, { taskId: task.id, dueAt: new Date(Date.now() + 30_000).toISOString(), idempotencyKey: crypto.randomUUID() });
    let fail = true;
    await page.route("**/api/map-attention?*", route => fail ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Temporary QA failure" }) }) : route.continue());
    await page.goto("/");
    await openMapCity(page);
    await page.locator(".game-popover > summary").filter({hasText:"Фильтры"}).click();
    await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit", "atomic");
    const menu = page.getByRole("navigation", { name: "Подсветка построек" });
    await menu.getByRole("button", { name: "Срыв сроков", exact: true }).click();
    await expect(menu.getByRole("button", { name: "Повторить загрузку" })).toBeVisible();
    await expect(page.locator(".world-canvas")).toHaveAttribute("data-attention-tasks", "0");
    fail = false;
    await menu.getByRole("button", { name: "Повторить загрузку" }).click();
    await expect(menu.getByRole("status")).toContainText("Найдено:");
    const before = Number((await menu.getByRole("status").innerText()).split(":")[1]);
    await page.clock.fastForward(35_000);
    await expect(menu.getByRole("status")).toHaveText(`Найдено: ${before + 1}`);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      for (const label of ["Мои объекты", "Приёмка", "Нужен ремонт", "Срыв сроков"]) {
        const button = menu.getByRole("button", { name: label, exact: true });
        await expect(button).toBeInViewport();
        expect(await button.evaluate(el => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight)).toBe(true);
      }
    }
  } finally {
    await service.updateTaskFields(bootstrap.country.id, { taskId: task.id, dueAt: task.dueAt, idempotencyKey: crypto.randomUUID() });
    await db.close();
  }
});
