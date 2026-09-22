import { expect, test } from "@playwright/test";
import { AppService } from "../../src/server/app-service";
import { createDb } from "../../src/server/db";
import type { CitySceneDto } from "../../src/shared/city-scene-contract";
import { expandCellRuns } from "../../src/shared/world-cell-runs";
import { districtDevelopmentSummary } from "../../src/client/district-development";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

test("active district is visible in city mode and empty plans never reserve land", async ({ page }, info) => {
  test.skip(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.E2E_BASE_URL ?? ""), "Local isolated fixture only");
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  expect((await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } })).ok()).toBe(true);
  const bootstrap = await (await page.request.get("/api/bootstrap")).json();
  expect(bootstrap.country.name).toBe("Тестовая страна");
  const db = await createDb(process.env.E2E_DATABASE_URL ?? "postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test", { migrate: false });
  const service = new AppService(db);
  const districts = await service.listDistricts(bootstrap.country.id, bootstrap.initialCity.id);
  const active = districts.find(d => d.status === "ACTIVE")!;
  const tokenResponse = await page.request.post("/api/tokens", { data: { name: "District development QA", scopes: ["districts:write"], expiresInDays: 30 } });
  expect(tokenResponse.ok()).toBe(true);
  const token = await tokenResponse.json();
  const client = new Client({ name: "district-development-qa", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", process.env.E2E_BASE_URL), {
    requestInit: { headers: { Authorization: `Bearer ${token.token}` } },
  }));
  let empty: Awaited<ReturnType<typeof service.createDistrict>> | undefined;
  try {
    await page.goto("/");
    await page.getByRole("navigation", { name: "Уровень карты" }).getByRole("button", { name: "Город", exact: true }).click();
    const host = page.locator(".world-canvas");
    await expect(host).toHaveAttribute("data-city-scene-commit", "atomic");
    await expect(host).toHaveAttribute("data-district-boundary-visible", "false");
    await expect.poll(async () => Number(await host.getAttribute("data-development-fences"))).toBeGreaterThan(0);
    expect(Number(await host.getAttribute("data-development-fences"))).toBeLessThanOrEqual(48);
    await page.screenshot({ path: info.outputPath("active-district.png") });
    await expect.poll(async () => Number(await host.getAttribute("data-construction-workers"))).toBeGreaterThan(0);
    expect(Number(await host.getAttribute("data-construction-workers"))).toBeLessThanOrEqual(8);
    expect(Number(await host.getAttribute("data-construction-materials"))).toBeLessThanOrEqual(16);
    // Reduced motion must work in a populated active district, not only an empty plan.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await page.getByRole("navigation", { name: "Уровень карты" }).getByRole("button", { name: "Город", exact: true }).click();
    await expect(host).toHaveAttribute("data-city-scene-commit", "atomic");
    await expect(host).toHaveAttribute("data-construction-workers", "0");
    await expect.poll(async () => Number(await host.getAttribute("data-development-fences"))).toBeGreaterThan(0);
    await page.screenshot({ path: info.outputPath("active-district-static.png") });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.reload();
    await page.getByRole("navigation", { name: "Уровень карты" }).getByRole("button", { name: "Город", exact: true }).click();
    await expect.poll(async () => Number(await host.getAttribute("data-construction-workers"))).toBeGreaterThan(0);
    const bakes = await host.getAttribute("data-ground-rebuilds");
    await page.getByRole("button", { name: "Районы", exact: true }).click();
    await page.getByRole("button", { name: "Город", exact: true }).click();
    expect(await host.getAttribute("data-ground-rebuilds")).toBe(bakes);
    empty = await service.createDistrict(bootstrap.country.id, { cityId: bootstrap.initialCity.id,
      name: `Будущий район ${crypto.randomUUID().slice(0, 8)}`, activate: false, idempotencyKey: crypto.randomUUID() });
    expect(empty.cells).toEqual([]);
    expect(empty.lots).toEqual([]);
    await page.reload();
    await page.getByRole("navigation", { name: "Уровень карты" }).getByRole("button", { name: "Город", exact: true }).click();
    const notice = page.getByRole("navigation", { name: "Районы без участков" });
    await expect(notice).toContainText(empty.name);
    await notice.getByRole("button", { name: new RegExp(empty.name) }).click();
    await expect(page.locator(".city-directory")).toContainText(empty.name);
    await page.keyboard.press("Escape");
    const activated = await client.callTool({ name: "district.activate", arguments: {
      countryId: bootstrap.country.id, districtId: empty.id, idempotencyKey: crypto.randomUUID(),
    } });
    expect(activated.isError).not.toBe(true);
    await expect(host).toHaveAttribute("data-development-fences", "0", { timeout: 15_000 });
    await expect(notice).toContainText("Подготовка района");
    await expect(host).toHaveAttribute("data-construction-workers", "0");
    await expect(host).toHaveAttribute("data-construction-materials", "0");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await page.getByRole("navigation", { name: "Уровень карты" }).getByRole("button", { name: "Город", exact: true }).click();
    await expect(notice).toContainText(empty.name);
    expect(errors).toEqual([]);
  } finally {
    await service.activateDistrict(bootstrap.country.id, active.id, crypto.randomUUID());
    if (empty) await service.deleteDistrict(bootstrap.country.id, { districtId: empty.id, confirmName: empty.name, idempotencyKey: crypto.randomUUID() });
    await client.close();
    await page.request.delete(`/api/tokens/${token.id}`);
    await db.close();
  }
});


test("указатель района занимает свободный участок, сводка открывается отдельно от карты", async ({ page }, info) => {
  const errors: string[] = [], sceneRequests: string[] = [], legacyRequests: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    if (new URL(request.url()).pathname.endsWith("/scene")) sceneRequests.push(request.url());
    if (/\/api\/(world\/viewport|chunks\/)/.test(request.url())) legacyRequests.push(request.url());
  });
  expect((await page.request.post("/api/auth/login", { data: { email: "demo@tasktopia.local", password: "tasktopia-demo" } })).ok()).toBe(true);
  await page.goto("/");
  const response = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/scene"));
  await page.getByRole("navigation", { name: "Уровень карты" }).getByRole("button", { name: "Город", exact: true }).click();
  const scene = await (await response).json() as CitySceneDto;
  const host = page.locator(".world-canvas");
  await expect(host).toHaveAttribute("data-city-scene-commit", "atomic");
  await expect.poll(async () => JSON.parse(await host.getAttribute("data-development-markers") ?? "[]").length).toBeGreaterThan(0);
  type Marker = { districtId: string; x: number; y: number; width: number; height: number };
  const markers = JSON.parse((await host.getAttribute("data-development-markers"))!) as Marker[];
  const blocked = new Set<string>();
  for (const chunk of scene.chunks) {
    for (const cell of expandCellRuns([...chunk.roadRuns, ...chunk.surfaceRuns, ...chunk.decorationContext.blockedCellRuns])) blocked.add(`${cell.x},${cell.y}`);
    for (const object of [...chunk.tasks, ...chunk.worldFeatures]) for (const cell of [...object.footprint, ...object.accessPath]) blocked.add(`${cell.x},${cell.y}`);
    for (const site of chunk.plannedSites ?? []) for (let y=0;y<site.height;y++) for (let x=0;x<site.width;x++) blocked.add(`${site.origin.x+x},${site.origin.y+y}`);
  }
  for (const marker of markers) {
    expect([marker.width, marker.height]).toEqual([16,16]);
    const owned = new Set(scene.chunks.flatMap(chunk=>chunk.districts.filter(d=>d.id===marker.districtId).flatMap(d=>expandCellRuns(d.cellRuns))).map(c=>`${c.x},${c.y}`));
    for (let y=marker.y/8;y<(marker.y+marker.height)/8;y++) for (let x=marker.x/8;x<(marker.x+marker.width)/8;x++) {
      expect(blocked.has(`${x},${y}`), `Указатель пересёк занятый участок ${x},${y}`).toBe(false);
      expect(owned.has(`${x},${y}`)).toBe(true);
    }
  }
  const marker = markers[0]!;
  const tasks = [...scene.chunks.flatMap(chunk=>chunk.tasks), ...scene.completedDistrictSnapshots.flatMap(d=>d.tasks)].filter(task=>task.districtId===marker.districtId);
  const summary = districtDevelopmentSummary("", tasks);
  const canvas = page.locator("canvas[aria-label='Интерактивная карта города']");
  for (const viewport of [{width:1440,height:900},{width:1440,height:1100},{width:390,height:844}]) {
    await page.setViewportSize(viewport);
    await expect(host).toHaveAttribute("data-minimum-render-scale", "0.8");
    const point = async () => {
      const box=(await canvas.boundingBox())!, scale=Number(await host.getAttribute("data-render-scale"));
      return { x:box.x+box.width/2+(marker.x+8-Number(await host.getAttribute("data-camera-world-x"))*8)*scale,
        y:box.y+box.height/2+(marker.y+8-Number(await host.getAttribute("data-camera-world-y"))*8)*scale, box };
    };
    const before = await point(), center={x:before.box.x+before.box.width/2,y:before.box.y+before.box.height/2};
    if (Math.hypot(center.x-before.x,center.y-before.y)>10) {
      await page.mouse.move(center.x,center.y);await page.mouse.down();
      await page.mouse.move(center.x+center.x-before.x,center.y+center.y-before.y,{steps:12});await page.mouse.up();
    }
    // Wait for the camera to publish the completed pan and the drag selection guard.
    await expect.poll(async()=> {const p=await point();return p.x>p.box.x&&p.x<p.box.x+p.box.width&&p.y>p.box.y&&p.y<p.box.y+p.box.height;}).toBe(true);
    await page.mouse.move(10,10);
    await expect(page.locator(".city-directory,.task-modal")).toHaveCount(0);
    await page.screenshot({path:info.outputPath(`district-marker-${viewport.width}x${viewport.height}.png`)});
    // A deliberate press outlasts the documented 500 ms guard after dragging.
    const after=await point();await page.mouse.click(after.x,after.y,{delay:550});
    const panel=page.getByRole("complementary",{name:"Районы города"});await expect(panel).toBeVisible();
    await expect(panel.getByRole("group",{name:"Сводка района"})).toContainText(summary.line);
    await expect(panel.getByRole("group",{name:"Сводка района"})).toContainText(summary.detail);
    await expect(page.locator(".task-modal")).toHaveCount(0);
    if (viewport.width===390) {
      const {default:AxeBuilder}=await import("@axe-core/playwright");
      expect((await new AxeBuilder({page}).include(".city-directory").withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze()).violations).toEqual([]);
      const close=(await panel.getByRole("button",{name:"Закрыть список"}).boundingBox())!;
      expect(close.width).toBeGreaterThanOrEqual(44);expect(close.height).toBeGreaterThanOrEqual(44);
    }
    const bounds=(await panel.boundingBox())!;expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({path:info.outputPath(`district-panel-${viewport.width}x${viewport.height}.png`)});
    await panel.getByRole("button",{name:"Закрыть список"}).click();
    await expect(panel).toHaveCount(0);
    expect(JSON.parse((await host.getAttribute("data-development-markers"))!)).toEqual(markers);
  }
  // The header remains an accessible entry for densely built districts without a free sign site.
  await page.getByRole("button",{name:/Районы города /}).click();
  await expect(page.getByRole("complementary",{name:"Районы города"}).getByRole("heading",{name:/Районы/})).toBeVisible();
  expect(sceneRequests).toHaveLength(1);expect(legacyRequests).toEqual([]);expect(errors).toEqual([]);
});
