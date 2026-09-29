import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function openPassport(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.locator(".country-title-button").click();
  await page.getByRole("button", { name: "Паспорт страны", exact: true }).click();
  return page.locator(".country-government-dialog");
}

test("owner invites a registered viewer, handles errors and revokes access with confirmation", async ({ page, playwright }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const guest = await playwright.request.newContext({ baseURL: String(info.project.use.baseURL) });
  const email = `government-${Date.now()}@example.test`;
  const registered = await guest.post("/api/auth/register", { data: { email, name: "Новый министр", password: "password-123", passwordConfirmation: "password-123", countryName: "Страна участника", cityName: "Город участника" } });
  expect(registered.ok()).toBe(true);
  await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } });
  const bootstrap = await (await page.request.get("/api/bootstrap")).json();
  const dialog = await openPassport(page);
  await dialog.getByRole("button", { name: "Пригласить участника", exact: true }).click();
  await expect(new AxeBuilder({ page }).include(".country-government-dialog").analyze().then(result => result.violations.filter(v => v.impact === "critical" || v.impact === "serious"))).resolves.toEqual([]);
  await page.screenshot({ path: info.outputPath("government-invite.png") });
  await dialog.getByLabel("Email участника").fill("missing-government@example.test");
  await dialog.getByRole("button", { name: "Открыть доступ", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("ещё не зарегистрирован");
  await dialog.getByLabel("Email участника").fill(email);
  await dialog.getByLabel("Полномочия", { exact: true }).selectOption("VIEWER");
  await dialog.getByRole("button", { name: "Открыть доступ", exact: true }).click();
  const member = dialog.locator("article").filter({ hasText: email });
  await expect(member).toContainText("Наблюдатель");
  expect((await guest.get(`/api/countries/${bootstrap.country.id}/members`)).status()).toBe(200);
  await member.getByLabel("Полномочия: Новый министр", { exact: true }).selectOption("MEMBER");
  await expect(dialog.getByRole("status")).toContainText("Полномочия обновлены");
  await expect(member.getByLabel("Полномочия: Новый министр", { exact: true })).toHaveValue("MEMBER");
  await dialog.getByRole("button", { name: "Пригласить участника", exact: true }).click();
  await dialog.getByLabel("Email участника").fill(email);
  await dialog.getByRole("button", { name: "Открыть доступ", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("уже состоит");
  await dialog.getByRole("button", { name: "Отмена приглашения" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate(n => n.scrollWidth <= n.clientWidth)).toBe(true);
  await member.getByRole("button", { name: "Закрыть доступ", exact: true }).click();
  await page.screenshot({ path: info.outputPath("government-revoke-mobile.png") });
  await member.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(member).toBeVisible();
  await member.getByRole("button", { name: "Закрыть доступ", exact: true }).click();
  await member.getByRole("button", { name: "Подтвердить отзыв доступа" }).click();
  await expect(member).toHaveCount(0);
  expect((await guest.get(`/api/countries/${bootstrap.country.id}/members`)).status()).toBe(403);
  await page.reload();
  await page.locator(".country-title-button").click();
  await page.getByRole("button", { name: "Паспорт страны", exact: true }).click();
  await expect(page.locator(".government-list")).not.toContainText(email);
  expect(errors).toEqual([]);
  await guest.dispose();
});

for (const role of ["MEMBER", "VIEWER"]) test(`${role} has no membership controls`, async ({ page }) => {
  await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } });
  await page.route("**/api/bootstrap", async route => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...await response.json(), countryRole: role } });
  });
  const dialog = await openPassport(page);
  await expect(dialog.locator(".government-list article").first()).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Пригласить|Закрыть доступ/ })).toHaveCount(0);
});

test("membership load failure retries without enabling changes against an unknown list", async ({ page }) => {
  await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } });
  await page.route("**/api/countries/*/members", route => route.fulfill({ status: 503, json: { message: "Недоступно" } }));
  const dialog = await openPassport(page);
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Пригласить участника" })).toHaveCount(0);
  await page.unroute("**/api/countries/*/members");
  await dialog.getByRole("button", { name: "Повторить" }).click();
  await expect(dialog.getByRole("button", { name: "Пригласить участника" })).toBeVisible();
});
