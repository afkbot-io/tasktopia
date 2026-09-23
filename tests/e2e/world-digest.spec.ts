import { test, expect } from "@playwright/test";
import { createDb } from "../../src/server/db";
import { AppService } from "../../src/server/app-service";
import { registerUser } from "../../src/server/auth";

test("a long digest title fits a phone and opens the task at its transferred location", async ({ page }, info) => {
  test.skip(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.E2E_BASE_URL ?? ""), "Local isolated fixture only");
  await page.setViewportSize({ width: 390, height: 844 });
  const database = process.env.E2E_DATABASE_URL ?? "postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test";
  expect(["127.0.0.1", "localhost"]).toContain(new URL(database).hostname);
  const db = await createDb(database, { migrate: false }), service = new AppService(db);
  const { user } = await registerUser(db, { email: `digest-transfer-${crypto.randomUUID()}@example.test`, name: "Сводка QA", password: "password123" });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    const country = user.countryId;
    const city = await service.createCity(country, { name: "Город сводки", idempotencyKey: crypto.randomUUID() });
    const from = await service.createDistrict(country, { cityId: city.id, name: "Первый район", activate: true, idempotencyKey: crypto.randomUUID() });
    const to = await service.createDistrict(country, { cityId: city.id, name: "Новый район", activate: false, idempotencyKey: crypto.randomUUID() });
    const title = `Проверка длинного заголовка ${"оченьдлинноеимябезпробелов".repeat(6)}`.slice(0, 160);
    const task = await service.createTask(country, { cityId: city.id, districtId: from.id, title, estimate: 1, idempotencyKey: crypto.randomUUID() });
    expect((await page.request.post("/api/auth/login", { data: { email: user.email, password: "password123" } })).ok()).toBe(true);
    await page.goto("/");
    await expect.poll(() => page.evaluate(({ u, c }) => localStorage.getItem(`tasktopia:digest:v1:${u}:${c}`), { u: user.id, c: country })).not.toBeNull();
    for (const status of ["STARTED", "IN_PROGRESS", "TESTING", "COMPLETED"] as const) {
      await service.updateTaskStatus(country, { taskId: task.id, status, comment: "QA completion", idempotencyKey: crypto.randomUUID() });
    }
    const moved = await service.transferTask(country, { taskId: task.id, targetDistrictId: to.id, idempotencyKey: crypto.randomUUID() });
    await page.reload();
    const summary = page.locator(".world-digest");
    await summary.getByLabel("Уведомления", { exact: true }).click();
    const card = summary.getByRole("button", { name: new RegExp(`№${task.taskNumber} ·`) });
    await expect(card).toContainText(title);
    const panel = summary.getByRole("region", { name: "Уведомления" });
    expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    const bounds = (await card.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: info.outputPath("long-transferred-digest.png") });
    const resolution = page.waitForResponse(response => response.url().includes(`/api/tasks/resolve?id=${task.id}`));
    await card.click();
    expect(await (await resolution).json()).toMatchObject({ id: task.id, countryId: country, origin: moved.origin });
    await expect(page.locator("#task-title")).toContainText(title);
    await expect(page.locator(".world-canvas")).toHaveAttribute("data-focus-x", String(moved.origin.x));
    await expect(page.locator(".world-canvas")).toHaveAttribute("data-focus-y", String(moved.origin.y));
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await db.prepare("DELETE FROM countries WHERE id=?").run(user.countryId);
    await db.prepare("DELETE FROM users WHERE id=?").run(user.id);
    await db.close();
  }
});
test("baselines first visit, shows later changes and acknowledges only an opened digest", async ({page}, info) => {
  test.skip(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.E2E_BASE_URL ?? ""), "Local isolated fixture only");
  await page.request.post("/api/auth/login",{data:{email:"demo@tasktopia.local",password:"tasktopia-demo"}});
  const bootstrap = await (await page.request.get("/api/bootstrap")).json();
  expect(bootstrap.country.name).toBe("Тестовая страна");
  const db = await createDb(process.env.E2E_DATABASE_URL ?? "postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test",{migrate:false});
  const ids: number[] = [];
  const other = await page.context().newPage();
  await page.clock.install();
  try {
    const initial = page.waitForResponse(r => r.url().includes("/api/world-digest") && r.status()===200);
    await page.goto("/");
    expect((await (await initial).json()).baseline).toBe(true);
    await expect.poll(() => page.evaluate(({u,c}) => localStorage.getItem(`tasktopia:digest:v1:${u}:${c}`),{u:bootstrap.user.id,c:bootstrap.country.id})).not.toBeNull();
    await expect(page.locator(".world-digest .notification-count")).toHaveCount(0);
    await other.goto("/");
    const task = (await db.prepare("SELECT t.id,t.title,t.task_number FROM tasks_v3 t JOIN cities_v3 c ON c.id=t.city_id WHERE c.country_id=? ORDER BY t.task_number LIMIT 1").get<{id:string;title:string;task_number:number}>(bootstrap.country.id))!;
    const event = await db.prepare("INSERT INTO events(country_id,type,world_version,payload_json,created_at) VALUES (?,'task.defect_created',1,?::jsonb,CURRENT_TIMESTAMP) RETURNING id").get<{id:number}>(bootstrap.country.id,JSON.stringify({taskId:task.id}));
    ids.push(Number(event!.id));
    await page.reload();
    const summary = page.locator(".world-digest");
    await expect(summary.locator(".notification-count")).toHaveText("1");
    await other.reload();
    await expect(other.locator(".world-digest .notification-count")).toHaveText("1");
    // Merely receiving the summary must not mark it read.
    await page.reload();
    await expect(summary.locator(".notification-count")).toHaveText("1");
    await summary.getByLabel("Уведомления",{exact:true}).click();
    await expect(summary.getByRole("region",{name:"Уведомления"})).toBeVisible();
    await expect(summary).toContainText(task.title);
    await page.screenshot({path:info.outputPath("world-digest.png")});
    await expect.poll(() => page.evaluate(({u,c}) => Number(localStorage.getItem(`tasktopia:digest:v1:${u}:${c}`)),{u:bootstrap.user.id,c:bootstrap.country.id})).toBeGreaterThanOrEqual(ids[0]!);
    await expect(other.locator(".world-digest .notification-count")).toHaveCount(0);
    // Background validation must not dismiss a panel being read.
    const revalidated = page.waitForResponse(r => r.url().includes("/api/world-digest") && r.status()===200);
    await page.clock.fastForward(61_000);
    await revalidated;
    await expect(summary.getByRole("region",{name:"Уведомления"})).toBeVisible();
    await expect(summary).toContainText(task.title);
    await summary.getByRole("button",{name:new RegExp(`№${task.task_number} ·`)}).click();
    await expect(page.locator(".task-modal")).toBeVisible();
    await page.reload();
    await expect(page.locator(".world-digest .notification-count")).toHaveCount(0);
  } finally {
    for (const id of ids) await db.prepare("DELETE FROM events WHERE id=? AND country_id=?").run(id,bootstrap.country.id);
    await other.close();
    await db.close();
  }
});

test("mobile digest scrolls, retries a failed request and hides data after access is denied", async ({page}, info) => {
  test.skip(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.E2E_BASE_URL ?? ""), "Local isolated fixture only");
  await page.setViewportSize({width:390,height:844});
  await page.request.post("/api/auth/login",{data:{email:"demo@tasktopia.local",password:"tasktopia-demo"}});
  const bootstrap = await (await page.request.get("/api/bootstrap")).json();
  expect(bootstrap.country.name).toBe("Тестовая страна");
  const db = await createDb(process.env.E2E_DATABASE_URL ?? "postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test",{migrate:false});
  let ids: number[] = [];
  try {
    await page.goto("/");
    await expect.poll(() => page.evaluate(({u,c}) => localStorage.getItem(`tasktopia:digest:v1:${u}:${c}`),{u:bootstrap.user.id,c:bootstrap.country.id})).not.toBeNull();
    const result = await db.prepare(`INSERT INTO events(country_id,type,world_version,payload_json,created_at)
      SELECT ?,'task.defect_created',1,jsonb_build_object('taskId',t.id),CURRENT_TIMESTAMP
      FROM tasks_v3 t JOIN cities_v3 c ON c.id=t.city_id WHERE c.country_id=? ORDER BY t.task_number LIMIT 20 RETURNING id`).all<{id:number}>(bootstrap.country.id,bootstrap.country.id);
    ids = result.map(row => Number(row.id));
    expect(ids).toHaveLength(20);
    await page.route("**/api/world-digest?**",route=>route.fulfill({status:503,json:{error:"UNAVAILABLE",message:"Temporary"}}));
    await page.reload();
    const summary = page.locator(".world-digest");
    await summary.getByLabel("Уведомления",{exact:true}).click();
    await page.unroute("**/api/world-digest?**");
    await summary.getByRole("button",{name:"Повторить загрузку сводки"}).click();
    await expect(summary.locator("li")).toHaveCount(20);
    const panel = summary.getByRole("region",{name:"Уведомления"});
    const bounds = await panel.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(390);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y+bounds!.height).toBeLessThan(780);
    expect(await panel.evaluate(node=>node.scrollHeight>node.clientHeight)).toBe(true);
    await summary.locator("li").last().scrollIntoViewIfNeeded();
    await page.screenshot({path:info.outputPath("mobile-digest.png")});
    await page.route("**/api/world-digest?**",route=>route.fulfill({status:403,json:{error:"FORBIDDEN",message:"Нет доступа к стране"}}));
    await page.evaluate(()=>window.dispatchEvent(new Event("online")));
    await expect(summary.locator("li")).toHaveCount(0);
    await summary.getByLabel("Уведомления",{exact:true}).click();
    await expect(summary.getByRole("button",{name:"Повторить загрузку сводки"})).toBeVisible();
  } finally {
    for(const id of ids) await db.prepare("DELETE FROM events WHERE id=? AND country_id=?").run(id,bootstrap.country.id);
    await db.close();
  }
});
