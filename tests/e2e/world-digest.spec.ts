import { expect, test } from "@playwright/test";
import { createDb } from "../../src/server/db";
test("server news keeps unseen cards, shares read state and retains history on mobile", async ({
  page,
}, info) => {
  test.skip(
    !/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.E2E_BASE_URL ?? ""),
    "Local fixture only",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.request.post("/api/auth/login", {
    data: { email: "demo@tasktopia.local", password: "tasktopia-demo" },
  });
  const b = await (await page.request.get("/api/bootstrap")).json();
  const db = await createDb(
    process.env.E2E_DATABASE_URL ??
      "postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test",
    { migrate: false },
  );
  let ids: number[] = [];
  try {
    const rows = await db
      .prepare(
        `INSERT INTO events(country_id,type,world_version,payload_json,created_at) SELECT ?,'task.defect_created',1,jsonb_build_object('taskId',t.id),CURRENT_TIMESTAMP FROM tasks_v3 t JOIN cities_v3 c ON c.id=t.city_id WHERE c.country_id=? ORDER BY t.task_number LIMIT 26 RETURNING id`,
      )
      .all<{ id: number }>(b.country.id, b.country.id);
    ids = rows.map((r) => Number(r.id));
    const initial = (
      await (
        await page.request.get(`/api/city-news?countryId=${b.country.id}`)
      ).json()
    ).unreadCount;
    await page.goto("/");
    const bell = page.locator(".world-digest");
    await bell.getByLabel("Уведомления", { exact: true }).click();
    await expect(bell.locator("li")).toHaveCount(20);
    await expect(bell.locator("li").first()).toBeVisible();
    await expect
      .poll(async () => {
        const d = await (
          await page.request.get(`/api/city-news?countryId=${b.country.id}`)
        ).json();
        return d.unreadCount;
      })
      .toBeLessThan(initial);
    const d = await (
      await page.request.get(`/api/city-news?countryId=${b.country.id}`)
    ).json();
    expect(d.unreadCount).toBeGreaterThan(0);
    await bell.getByRole("button", { name: "История", exact: true }).click();
    await expect(bell.locator("li")).toHaveCount(20);
    await bell.getByRole("button", { name: "Более ранние" }).click();
    await expect(bell.locator("li").first()).toBeVisible();
    const panel = bell.getByRole("region", { name: "Уведомления" });
    expect(await panel.evaluate((n) => n.scrollWidth <= n.clientWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath("news-mobile.png") });
    await bell.locator("li button").first().click();
    await expect(page.locator("#task-title")).toBeVisible();
  } finally {
    for (const id of ids)
      await db.prepare("DELETE FROM events WHERE id=?").run(id);
    await db.close();
  }
});
test("news failures retry and do not expose cached content", async ({
  page,
}) => {
  await page.request.post("/api/auth/login", {
    data: { email: "demo@tasktopia.local", password: "tasktopia-demo" },
  });
  await page.route("**/api/city-news?*", (r) =>
    r.fulfill({ status: 503, json: { message: "unavailable" } }),
  );
  await page.goto("/");
  await page.getByLabel("Уведомления", { exact: true }).click();
  const panel = page.getByRole("region", { name: "Уведомления" });
  await expect(panel.getByRole("alert")).toBeVisible();
  await page.route("**/api/city-news?*", (r) =>
    r.fulfill({ json: { items: [], unreadCount: 0, nextBefore: null } }),
  );
  await panel.getByRole("button", { name: "Повторить" }).click();
  await expect(panel.getByText("Новых событий пока нет.")).toBeVisible();
});
