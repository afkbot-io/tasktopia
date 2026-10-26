import { openMapCity } from "./map-navigation";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { expect, test } from "@playwright/test";
import { createDb } from "../../src/server/db";
import { AppService } from "../../src/server/app-service";
import { registerUser } from "../../src/server/auth";
import type { TaskStatus } from "../../src/shared/contracts";

test("active sprint signs survive matching, empty and reset native map filters", async ({ page, browserName }, info) => {
  const base = new URL(process.env.E2E_BASE_URL!);
  const database = process.env.E2E_DATABASE_URL!;
  expect(["127.0.0.1", "localhost"]).toContain(base.hostname);
  expect(["127.0.0.1", "localhost"]).toContain(new URL(database).hostname);
  const db = await createDb(database, { migrate: false });
  const service = new AppService(db);
  let user: Awaited<ReturnType<typeof registerUser>>["user"] | undefined;
  try {
    ({ user } = await registerUser(db, { email: `task-focus-${crypto.randomUUID()}@example.test`, name: "Фильтры города QA", password: "password123" }));
    await db.prepare("UPDATE countries SET seed=? WHERE id=?").run(424242, user.countryId);
    const city = await service.createCity(user.countryId, { name: "Город фильтров", idempotencyKey: crypto.randomUUID() });
    const previous = await service.createDistrict(user.countryId, { cityId: city.id, name: "Следующий спринт", activate: true, idempotencyKey: crypto.randomUUID() });
    const parked = await service.createTask(user.countryId, { cityId: city.id, districtId: previous.id, title: "Работа вне активного спринта", estimate: 1, idempotencyKey: crypto.randomUUID() });
    await service.updateTaskStatus(user.countryId, { taskId: parked.id, status: "STARTED", idempotencyKey: crypto.randomUUID() });
    const active = await service.createDistrict(user.countryId, { cityId: city.id, name: "Активный спринт", activate: false, idempotencyKey: crypto.randomUUID() });
    await service.activateDistrict(user.countryId, active.id, crypto.randomUUID());
    const mine = await service.createTask(user.countryId, { cityId: city.id, districtId: active.id, title: "Моя запланированная работа", estimate: 1, assigneeUserId: user.id, idempotencyKey: crypto.randomUUID() });
    const testing = await service.createTask(user.countryId, { cityId: city.id, districtId: active.id, title: "Проверка другой работы", estimate: 1, idempotencyKey: crypto.randomUUID() });
    const done = await service.createTask(user.countryId, { cityId: city.id, districtId: active.id, title: "Завершённая работа", estimate: 1, idempotencyKey: crypto.randomUUID() });
    for (const status of ["STARTED", "IN_PROGRESS", "TESTING", "COMPLETED"] satisfies TaskStatus[]) {
      if (status !== "COMPLETED") await service.updateTaskStatus(user.countryId, { taskId: testing.id, status, idempotencyKey: crypto.randomUUID() });
      await service.updateTaskStatus(user.countryId, { taskId: done.id, status, idempotencyKey: crypto.randomUUID() });
    }
    // This fixture distinguishes active PLANNING, active TESTING, completed,
    // and STARTED in a real PLANNED district; status alone cannot pick signs.
    const districts = await service.listDistricts(user.countryId, city.id);
    expect(districts.find(district => district.id === previous.id)?.status).toBe("PLANNED");
    expect(districts.find(district => district.id === active.id)?.status).toBe("ACTIVE");
    const tasks = await service.listTasks(user.countryId);
    expect(tasks.map(task => [task.id, task.status])).toEqual(expect.arrayContaining([
      [mine.id, "PLANNING"], [testing.id, "TESTING"], [done.id, "COMPLETED"], [parked.id, "STARTED"],
    ]));
    expect(tasks).toHaveLength(4);
    expect((await page.request.post("/api/auth/login", { data: { email: user.email, password: "password123" } })).ok()).toBe(true);
    const errors: string[] = [], writes: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(request.method())) writes.push(`${request.method()} ${new URL(request.url()).pathname}`); });
    await page.goto("/");
    await openMapCity(page);
    const host = page.locator(".world-canvas"), canvas = host.locator("canvas");
    await expect(host).toHaveAttribute("data-city-scene-commit", "atomic");
    await canvas.focus();
    for (let zoom = 0; zoom < 6 && await host.getAttribute("data-map-lod") !== "detail"; zoom++) {
      const scale = Number(await host.getAttribute("data-render-scale"));
      await page.keyboard.press("+");
      await expect.poll(async () => Number(await host.getAttribute("data-render-scale"))).toBeGreaterThan(scale);
    }
    await expect(host).toHaveAttribute("data-map-lod", "detail");
    await expect(host).toHaveAttribute("data-camera-presentation-pending", "false");
    await expect(host).toHaveAttribute("data-ground-bake-queue", "0");
    // All four fixture tasks must really be resident before exact mask counts.
    await expect(host).toHaveAttribute("data-task-building-views", "4");
    await expect(host).toHaveAttribute("data-task-sprint-badges", "2");
    await expect(host).toHaveAttribute("data-task-sprint-badge-textures", "1");
    await expect(host).toHaveAttribute("data-attention-active", "false");
    await expect(host).toHaveAttribute("data-attention-dimmed-tasks", "0");
    await page.getByLabel("Фильтры", { exact: true }).click();
    const menu = page.getByRole("navigation", { name: "Фильтры построек" });
    await menu.getByText("Значки работ", { exact: true }).click();
    const legend = menu.getByRole("list", { name: "Значки задач активного спринта" });
    await expect(legend.getByRole("listitem")).toHaveCount(6);
    const overflowingLabels = await legend.getByRole("listitem").evaluateAll(items => items.flatMap(item => {
      const label = item.querySelector("small")!, bounds = item.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(label);
      return [...range.getClientRects()].some(rect => rect.left < bounds.left - 1 || rect.right > bounds.right + 1
        || rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1) ? [label.textContent] : [];
    }));
    expect(overflowingLabels, "Legend labels must stay within their own items without overlapping adjacent signs").toEqual([]);
    const originalCanvas = await canvas.elementHandle();
    const before = await host.evaluate(el => [el.getAttribute("data-camera-world-x"), el.getAttribute("data-camera-world-y"), el.getAttribute("data-render-scale"), el.getAttribute("data-ground-rebuilds")]);
    let reads = 0;
    page.on("request", request => { if (request.url().includes("/api/map-attention?")) reads++; });
    await menu.getByRole("button", { name: "Мои объекты", exact: true }).click();
    await expect(menu.getByRole("status")).toHaveText("Найдено: 1");
    await expect(host).toHaveAttribute("data-attention-active", "true");
    await expect(host).toHaveAttribute("data-attention-tasks", "1");
    await expect(host).toHaveAttribute("data-attention-dimmed-tasks", "3");
    await expect(host).toHaveAttribute("data-attention-dim-alpha", "0.16");
    await expect(host).toHaveAttribute("data-task-sprint-badges", "2");
    const loadedReads = reads;
    await menu.getByRole("button", { name: "Приёмка", exact: true }).click();
    await expect(menu.getByRole("status")).toHaveText("Найдено: 0");
    await expect(menu.getByText("Подходящих задач нет. Измените условия или сбросьте фильтр.", { exact: true })).toBeVisible();
    await expect(host).toHaveAttribute("data-attention-active", "true");
    await expect(host).toHaveAttribute("data-attention-tasks", "0");
    await expect(host).toHaveAttribute("data-attention-dimmed-tasks", "4");
    await expect(host).toHaveAttribute("data-task-sprint-badges", "2");
    await page.screenshot({ path: info.outputPath("empty-active-mask.png") });
    await menu.getByRole("button", { name: "Сбросить фильтр", exact: true }).click();
    await expect(host).toHaveAttribute("data-attention-active", "false");
    await expect(host).toHaveAttribute("data-attention-tasks", "0");
    await expect(host).toHaveAttribute("data-attention-dimmed-tasks", "0");
    await expect(host).toHaveAttribute("data-task-sprint-badges", "2");
    await expect(menu.getByRole("button", { name: "Мои объекты", exact: true })).toHaveAttribute("aria-pressed", "false");
    await expect(menu.getByRole("button", { name: "Приёмка", exact: true })).toHaveAttribute("aria-pressed", "false");
    await expect(menu.getByRole("status")).toHaveCount(0);
    expect(reads).toBe(loadedReads);
    expect(await host.evaluate(el => [el.getAttribute("data-camera-world-x"), el.getAttribute("data-camera-world-y"), el.getAttribute("data-render-scale"), el.getAttribute("data-ground-rebuilds")])).toEqual(before);
    expect(await originalCanvas!.evaluate(node => node === document.querySelector(".world-canvas canvas"))).toBe(true);
    if (page.viewportSize()!.width <= 600) {
      await expect(menu.locator(".task-sprint-legend")).toHaveJSProperty("open", true);
      const reachAlbum = async (prefix = "") => {
        const panel = menu.locator(".."), album = panel.getByRole("button", { name: "Альбом города", exact: true });
        const metrics = await panel.evaluate(element => {
          const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom,
            viewportWidth: innerWidth, viewportHeight: innerHeight, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
            overflowY: style.overflowY, maxHeight: style.maxHeight };
        });
        // macOS WebKit includes buttons in Option-Tab navigation. Linux keeps
        // its native Tab policy; required CI verifies that host independently.
        const focusKey = process.platform === "darwin" ? "Alt+Tab" : "Tab";
        await info.attach(`${prefix}filter-panel-scroll`, { body: Buffer.from(JSON.stringify({ ...metrics, host: process.platform, focusKey }, null, 2)), contentType: "application/json" });
        expect(metrics.bottom, "The filter panel must stay inside the visible viewport").toBeLessThanOrEqual(metrics.viewportHeight + 1);
        const overflows = metrics.scrollHeight > metrics.clientHeight + 1;
        if (overflows) expect(metrics.overflowY).toMatch(/^(auto|scroll)$/);
        // Native input must reach the final command; no locator or DOM scroll.
        if (browserName === "webkit") {
          await menu.getByRole("button", { name: "Мои объекты", exact: true }).focus();
          for (let key = 0; key < 20 && !await album.evaluate(element => element === document.activeElement); key++) await page.keyboard.press(focusKey);
          await expect(album).toBeFocused();
          if (overflows) {
            await page.keyboard.press("PageDown");
            await expect.poll(() => panel.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
          }
        } else {
          await page.mouse.move(metrics.x + metrics.width / 2, Math.min(metrics.y + metrics.height / 2, metrics.viewportHeight - 20));
          await page.mouse.wheel(0, metrics.scrollHeight);
          if (overflows) await expect.poll(() => panel.evaluate(element => element.scrollTop + element.clientHeight >= element.scrollHeight - 2)).toBe(true);
        }
        await expect(album).toBeInViewport({ ratio: 1 });
        await page.screenshot({ path: info.outputPath(`${prefix}filter-panel-bottom.png`) });
        await album.click();
        const dialog = page.getByRole("dialog", { name: "Альбом города", exact: true });
        await expect(dialog).toHaveAttribute("aria-busy", "false");
        await expect(dialog).toContainText(city.name);
        await expect(dialog.getByRole("alert")).toHaveCount(0);
        await page.screenshot({ path: info.outputPath(`${prefix}filter-panel-album.png`) });
        return dialog;
      };
      const portraitAlbum = await reachAlbum();
      await portraitAlbum.getByRole("button", { name: "Закрыть альбом", exact: true }).click();
      await page.setViewportSize({ width: 844, height: 390 });
      const trigger = page.getByLabel("Фильтры", { exact: true });
      if (!await trigger.evaluate(element => element.closest("details")?.hasAttribute("open"))) await trigger.click();
      const legend = menu.locator(".task-sprint-legend");
      if (!await legend.evaluate(element => element.hasAttribute("open"))) await legend.locator("summary").click();
      await reachAlbum("landscape-");
    }
    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
  } finally {
    await page.close();
    if (user) {
      await db.prepare("DELETE FROM countries WHERE id=?").run(user.countryId);
      await db.prepare("DELETE FROM users WHERE id=?").run(user.id);
    }
    await db.close();
  }
});

test("attention dims other buildings without camera or terrain changes", async ({ page }, info) => {
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
    await expect(page.getByRole("navigation", { name: "Фильтры построек" })).toBeVisible();
    await expect(page.locator(".app-header").getByRole("navigation", { name: "Фильтры построек" })).toBeVisible();
    await expect(page.locator(".app-header").getByRole("button", { name: "Развитие города" })).toBeVisible();
    const host = page.locator(".world-canvas");
    await expect(host).toHaveAttribute("data-city-scene-commit", "atomic");
    const before = await host.evaluate(el => [el.getAttribute("data-camera-world-x"), el.getAttribute("data-camera-world-y"), el.getAttribute("data-ground-rebuilds")]);
    const menu = page.getByRole("navigation", { name: "Фильтры построек" });
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
    await expect(menu.getByRole("button", { name: "Мои объекты", exact: true })).toHaveAttribute("aria-pressed", "true");
    // Filters intersect: our assigned completed task cannot also be in testing.
    await expect(host).toHaveAttribute("data-attention-tasks", "0");
    await menu.getByRole("button", { name: "Приёмка", exact: true }).click();
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
  let releaseMetadata!: () => void;
  const metadataGate = new Promise<void>(resolve => { releaseMetadata = resolve; });
  try {
    await service.updateTaskFields(bootstrap.country.id, { taskId: task.id, dueAt: new Date(Date.now() + 30_000).toISOString(), idempotencyKey: crypto.randomUUID() });
    let fail = true;
    await page.route("**/api/map-attention?*", async route => {
      if (!fail) return route.continue();
      await metadataGate;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Temporary QA failure" }) });
    });
    await page.goto("/");
    await openMapCity(page);
    await page.locator(".game-popover > summary").filter({hasText:"Фильтры"}).click();
    const host = page.locator(".world-canvas");
    await expect(host).toHaveAttribute("data-city-scene-commit", "atomic");
    const menu = page.getByRole("navigation", { name: "Фильтры построек" });
    await menu.getByRole("button", { name: "Срыв сроков", exact: true }).click();
    await expect(menu.getByRole("status")).toHaveText("Загрузка…");
    await expect(host).toHaveAttribute("data-attention-active", "false");
    await expect(host).toHaveAttribute("data-attention-dimmed-tasks", "0");
    releaseMetadata();
    await expect(menu.getByRole("button", { name: "Повторить загрузку" })).toBeVisible();
    await expect(host).toHaveAttribute("data-attention-tasks", "0");
    await expect(host).toHaveAttribute("data-attention-active", "false");
    await expect(host).toHaveAttribute("data-attention-dimmed-tasks", "0");
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
    releaseMetadata();
    await service.updateTaskFields(bootstrap.country.id, { taskId: task.id, dueAt: task.dueAt, idempotencyKey: crypto.randomUUID() });
    await db.close();
  }
});
