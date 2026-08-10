import { expect, test } from "@playwright/test";

test("slow sprite downloads do not block the chunk API pipeline", async ({ page }) => {
  test.setTimeout(60_000);
  const chunkStarts: number[] = [];
  let firstChunkStarted: (() => void) | undefined;
  const firstChunk = new Promise<void>((resolve) => { firstChunkStarted = resolve; });

  await page.route("**/game-assets/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    await route.continue();
  });
  page.on("request", (request) => {
    if (!request.url().includes("/api/chunks/")) return;
    chunkStarts.push(Date.now());
    firstChunkStarted?.();
    firstChunkStarted = undefined;
  });

  await page.goto("/");
  await page.getByLabel("Email").fill("demo@tasktopia.local");
  await page.getByLabel("Пароль").fill("tasktopia-demo");
  await page.getByRole("button", { name: "Открыть страну" }).click();
  await firstChunk;

  await expect.poll(() => chunkStarts.length, {
    message: "chunk JSON requests must keep flowing while sprites are still downloading",
    timeout: 1_500,
  }).toBeGreaterThanOrEqual(6);
});
