import { expect, test } from "@playwright/test";

test("resident images finishing on the planet do not rebuild the hidden city", async ({ page }) => {
  expect((await page.request.post("/api/auth/login", { data: {
    email: "demo@tasktopia.local", password: "tasktopia-demo",
  } })).ok()).toBe(true);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/micro-ambient/**", async route => { await gate; await route.continue(); });
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Город", exact: true }).click();
    const host = page.locator(".world-canvas");
    await expect(host).toHaveAttribute("data-city-scene-commit", "atomic");
    const rebuilds = await host.getAttribute("data-entity-rebuilds");
    await page.getByRole("button", { name: "Планета", exact: true }).click();
    await expect(page.locator(".planet-atlas")).toHaveAttribute("data-planet-ready", "true");
    release();
    await expect(host).toHaveAttribute("data-ambient-assets", "ready");
    // Allow pending animation-frame reconciliation to run, if incorrectly scheduled.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await host.getAttribute("data-walk-network-builds")).toBeNull();
    expect(await host.getAttribute("data-entity-rebuilds")).toBe(rebuilds);
    await page.getByRole("button", { name: "Город", exact: true }).click();
    await expect.poll(async () => Number(await host.getAttribute("data-walk-network-builds") ?? 0)).toBeGreaterThan(0);
  } finally { release(); }
});

test("city starts building images while terrain is pending, but waits before publishing", async ({ page }) => {
  expect((await page.request.post("/api/auth/login", { data: {
    email: "demo@tasktopia.local", password: "tasktopia-demo",
  } })).ok()).toBe(true);
  let release!: () => void;
  const terrainGate = new Promise<void>(resolve => { release = resolve; });
  let terrainRequested = false;
  let buildingRequested = false;
  await page.route("**/atlas/terrain-v4/city/*.png", async route => {
    terrainRequested = true;
    await terrainGate;
    await route.continue();
  });
  page.on("request", request => {
    if (/\/buildings\/.*\/stage-[345]\.png/.test(request.url())) buildingRequested = true;
  });
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Город", exact: true }).click();
    await expect.poll(() => terrainRequested).toBe(true);
    await expect.poll(() => buildingRequested, { timeout: 5000 }).toBe(true);
    await expect(page.locator(".world-canvas")).not.toHaveAttribute("data-city-scene-commit", "atomic");
  } finally { release(); }
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 30_000 });
});

test("city reuses the authored prop atlas instead of fetching individual park and construction props", async ({ page }, info) => {
  expect((await page.request.post("/api/auth/login", { data: {
    email: "demo@tasktopia.local", password: "tasktopia-demo",
  } })).ok()).toBe(true);
  const standalone: string[] = [];
  page.on("request", request => {
    if (/\/props\/[^/]+\.png/.test(request.url())) standalone.push(request.url());
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Город", exact: true }).click();
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 30_000 });
  expect(standalone).toEqual([]);
  await page.screenshot({ path: info.outputPath("city-props.png") });
});

test("a delayed first connection preserves the initial scene through first-frame activation", async ({ page }) => {
  expect((await page.request.post("/api/auth/login", { data: {
    email: "demo@tasktopia.local", password: "tasktopia-demo",
  } })).ok()).toBe(true);
  let release!: () => void;
  const connected = new Promise<void>(resolve => { release = resolve; });
  let rendererStarted!: () => void;
  const rendererGate = new Promise<void>(resolve => { rendererStarted = resolve; });
  // Connect only after WorldCanvas has mounted, before its first frame.
  // A first connection must not invalidate the freshly bootstrapped scene.
  let scenes = 0;
  await page.route("**/socket.io/**", async route => { await rendererGate; await route.continue(); });
  page.on("request", request => {
    if (new URL(request.url()).pathname.endsWith("/scene")) scenes++;
    if (request.url().includes("/api/events?")) release();
  });
  await page.route("**/atlas/terrain-v4/city/*.png", async route => {
    rendererStarted(); await connected; await route.continue();
  });
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Город", exact: true }).click();
    const host = page.locator(".world-canvas");
    await expect(host).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 30_000 });
    expect(Number(await host.getAttribute("data-transport-only-refreshes") ?? 0)).toBe(0);
    expect(scenes).toBe(1);
    expect(await host.getAttribute("data-ground-rebuilds")).toBe(await host.getAttribute("data-city-scene-chunks"));
  } finally { rendererStarted(); release(); }
});

test("walking routes wait for resident sprites without holding the first city frame", async ({ page }) => {
  expect((await page.request.post("/api/auth/login", { data: {
    email: "demo@tasktopia.local", password: "tasktopia-demo",
  } })).ok()).toBe(true);
  let release!: () => void;
  const residents = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/micro-ambient/*.png", async route => { await residents; await route.continue(); });
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Город", exact: true }).click();
    const host = page.locator(".world-canvas");
    await expect(host).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 30_000 });
    expect(Number(await host.getAttribute("data-walk-network-builds") ?? 0)).toBe(0);
    expect(Number(await host.getAttribute("data-entity-rebuilds"))).toBe(1);
    release();
    await expect(host).toHaveAttribute("data-ambient-assets", "ready");
    await expect.poll(async () => Number(await host.getAttribute("data-walk-network-builds") ?? 0)).toBeGreaterThan(0);
  } finally { release(); }
});
