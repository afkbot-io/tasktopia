import { expect, test } from "@playwright/test";

test("uses the game asset pack without exposing implementation notes", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText(/HTTP-only|Пароль не передаётся интеграциям/i)).toHaveCount(0);
  const sceneSprites = page.locator("[data-auth-scene-sprite]");
  await expect(sceneSprites).toHaveCount(8);
  for (const sprite of await sceneSprites.all()) {
    await expect(sprite).toHaveAttribute("src", /\/game-assets\/v5\/revisions\/[a-f0-9]{16}\//);
  }
});

test("keeps the mobile game scene below the hero copy", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const copy = await page.getByText(/Tasktopia превращает ваши дела/).boundingBox();
  const scene = await page.locator(".auth-world").boundingBox();
  expect(copy).not.toBeNull();
  expect(scene).not.toBeNull();
  expect(scene!.y).toBeGreaterThanOrEqual(copy!.y + copy!.height - 4);
});

test("shows a clear duplicate-registration error and keeps the form usable", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Нет аккаунта? Зарегистрироваться" }).click();
  await page.getByLabel("Имя", { exact: true }).fill("Duplicate Mayor");
  await page.getByLabel("Название вашей первой страны").fill("Duplicate Product");
  await page.getByLabel("Название первого города").fill("Duplicate Epic");
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль", { exact: true }).fill("safe-password-123");
  await page.getByLabel("Повторите пароль", { exact: true }).fill("safe-password-123");
  await page.getByRole("button", { name: "Создать аккаунт" }).click();

  await expect(page.getByRole("alert")).toHaveText("Аккаунт с таким email уже существует");
  await expect(page.getByRole("button", { name: "Создать аккаунт" })).toBeEnabled();
});

test("requires matching passwords before sending registration", async ({ page }) => {
  let registrationRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/auth/register")) registrationRequests += 1;
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Нет аккаунта? Зарегистрироваться" }).click();
  await page.getByLabel("Имя", { exact: true }).fill("Private Mayor");
  await page.getByLabel("Название вашей первой страны").fill("Private Product");
  await page.getByLabel("Название первого города").fill("Private City");
  await page.getByLabel("Email").fill("private@example.test");
  await page.getByLabel("Пароль", { exact: true }).fill("safe-password-123");
  await page.getByLabel("Повторите пароль", { exact: true }).fill("different-password-456");
  await page.getByRole("button", { name: "Создать аккаунт" }).click();

  await expect(page.getByRole("alert")).toHaveText("Пароли не совпадают");
  expect(registrationRequests).toBe(0);
});

test("shows only login when public registration is disabled", async ({ page }) => {
  await page.route("**/api/auth/config", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ registrationEnabled: false }),
    });
  });

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Войти в Tasktopia" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Нет аккаунта? Зарегистрироваться" })).toHaveCount(0);
});

test("keeps authentication pending through bootstrap and offers retry after a country-load failure", async ({ page }) => {
  let failNextBootstrap = false;
  await page.route("**/api/bootstrap", async (route) => {
    if (failNextBootstrap) {
      failNextBootstrap = false;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "Не удалось загрузить страну. Повторите запрос" }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/");
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль", { exact: true }).fill("tasktopia-demo");
  failNextBootstrap = true;
  await page.getByRole("button", { name: "Открыть страну" }).click();

  await expect(page.getByRole("alert")).toHaveText("Не удалось загрузить страну. Повторите запрос");
  await page.getByRole("button", { name: "Повторить загрузку" }).click();
  await expect(page.locator("canvas[aria-label='Интерактивная карта города']")).toBeVisible();
});
