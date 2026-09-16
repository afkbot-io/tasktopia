import { expect, test } from "@playwright/test";

for (const dpr of [1, 2]) test.describe(`country labels DPR ${dpr}`, () => {
  test.use({ deviceScaleFactor: dpr });
  test("follows cities offscreen and back without stale edge labels or data reloads", async ({ page }) => {
    test.skip(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.E2E_BASE_URL ?? ""), "Local fixture only");
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    expect((await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } })).ok()).toBe(true);
    await page.goto("/");
    await page.getByRole("button", { name: "Страна", exact: true }).click();
    const map = page.locator(".country-overview");
    await expect(map).toHaveAttribute("data-country-ready", "true");
    await expect(map).toHaveAttribute("data-country-label-mode", "full");
    const labels = map.locator(".country-overview-city:visible");
    const original = await labels.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-city-id")));
    expect(original.length).toBeGreaterThan(0);
    const reads: string[] = [];
    page.on("request", request => {
      if (/\/overview(?:\?|$)/.test(request.url())) reads.push(request.url());
    });
    const box = (await map.boundingBox())!;
    const left = box.x + 30, right = box.x + box.width - 30, y = box.y + 30;
    const drag = async (from: number, to: number) => {
      await page.mouse.move(from, y);
      await page.mouse.down();
      await page.mouse.move(to, y, { steps: 12 });
      await page.mouse.up();
    };
    for (let i = 0; i < 2; i++) await drag(left, right);
    await expect(labels).toHaveCount(0);
    await expect(map.locator(".country-city-leader:visible")).toHaveCount(0);
    for (let i = 0; i < 2; i++) await drag(right, left);
    await expect.poll(() => labels.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-city-id")))).toEqual(original);
    expect(reads).toEqual([]);
    expect(errors).toEqual([]);
  });
});
