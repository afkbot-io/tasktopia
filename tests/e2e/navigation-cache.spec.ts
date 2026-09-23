import { expect, test, type Page } from "@playwright/test";
import type { BootstrapDto, RealtimeEvent } from "../../src/shared/contracts";
import type { CitySceneDto } from "../../src/shared/city-scene-contract";
import { PLANET_REVALIDATE_MS } from "../../src/client/planet-atlas-cache";

test.skip(process.env.E2E_NAVIGATION_FIXTURE !== "true", "Read-only run against the explicitly selected compact/atlas QA schema");
test.use({ viewport: { width: 1440, height: 1000 }, trace: { mode: "retain-on-failure", screenshots: false, snapshots: true, sources: true } });

async function login(page: Page): Promise<{ initialMap: "PLANET"; loginToFirstFrameMs: number }> {
  await page.goto("/");
  await page.getByLabel("Email").fill(process.env.E2E_NAVIGATION_EMAIL ?? "demo@tasktopia.local");
  await page.getByLabel("Пароль").fill(process.env.E2E_NAVIGATION_PASSWORD ?? "tasktopia-demo");
  await armTiming(page, "ENTRY");
  await page.getByRole("button", { name: "Открыть страну" }).click();
  const loginToFirstFrameMs = await finishTiming(page);
  const initialMap = "PLANET" as const;
  await page.getByRole("navigation",{name:"Уровень карты"}).getByRole("button",{name:"Город",exact:true}).click();
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-city-scene-commit", "atomic", { timeout: 60_000 });
  return { initialMap, loginToFirstFrameMs };
}
async function openTask(page: Page, number: number): Promise<void> {
  await page.getByRole("search").getByRole("textbox").fill(String(number));
  await page.getByRole("option").filter({ hasText: `#${number}` }).first().click();
  await expect(page.locator("#task-title")).toBeVisible();
}
const isDataRead = (path: string) => /\/scene$|\/overview$|\/planet-atlas$|\/world\/viewport|\/chunks\//.test(path);
const isTaskRead = (path: string) => /^\/api\/tasks\/[\da-f-]{36}$/.test(path);

/** Timer starts on the actual trusted UI click, finishes in the browser RAF
 * after the target first frame and transition cover. Playwright polling is
 * outside the measured interval. This observes DOM only, not renderer internals. */
async function armTiming(page: Page, target: "CITY" | "PLANET" | "TASK" | "ENTRY"): Promise<void> {
  await page.evaluate(target => {
    const state = { start: 0, elapsed: -1, target };
    (window as typeof window & { __navigationTiming?: typeof state }).__navigationTiming = state;
    document.addEventListener("click", () => {
      state.start = performance.now();
      const check = () => {
        const selectors = { CITY: '.world-canvas[data-map-active="true"][data-city-scene-commit="atomic"]',
          PLANET: '.planet-atlas[data-planet-ready="true"]', TASK: '#task-title',
          ENTRY: '.planet-atlas[data-planet-ready="true"]' };
        const element = document.querySelector<HTMLElement>(selectors[target]);
        if (element && getComputedStyle(element).visibility !== "hidden" && !document.querySelector(".map-level-transition")) state.elapsed = performance.now() - state.start;
        else if (performance.now() - state.start < 30_000) requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    }, { once: true, capture: true });
  }, target);
}
async function finishTiming(page: Page): Promise<number> {
  await page.waitForFunction(() => ((window as typeof window & { __navigationTiming?: { elapsed: number } }).__navigationTiming?.elapsed ?? -1) >= 0);
  return page.evaluate(() => (window as typeof window & { __navigationTiming: { elapsed: number } }).__navigationTiming.elapsed);
}

test("replays both task statuses before renderer readiness, caches task cards, and retries a failed authoritative refresh", async ({ page, context }, info) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  let scene!: CitySceneDto;
  let bootstrap!: BootstrapDto;
  let releaseScene!: () => void;
  const sceneGate = new Promise<void>(resolve => { releaseScene = resolve; });
  let sceneCaptured!: () => void;
  const captured = new Promise<void>(resolve => { sceneCaptured = resolve; });
  let phase: "initial" | "comment" | "rename" | "done" = "initial";
  let replayBatches = 0;
  let failRefresh = false;
  let authoritativeRefreshes = 0;
  let targetIds: string[] = [];
  const reads: string[] = [];
  page.on("request", request => {
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "GET" && (isDataRead(pathname) || isTaskRead(pathname) || pathname === "/api/bootstrap")) reads.push(pathname);
  });
  await page.route("**/api/bootstrap", async route => {
    const response = await route.fetch();
    if (response.ok()) bootstrap = await response.json() as BootstrapDto;
    await route.fulfill({ response });
  });
  await page.route("**/api/countries/*/cities/*/scene", async route => {
    if (scene && failRefresh) { failRefresh = false; await route.fulfill({ status: 503, json: { message: "Intentional one-shot QA refresh failure" } }); return; }
    const response = await route.fetch();
    const next = await response.json() as CitySceneDto;
    if (!scene) {
      scene = next;
      sceneCaptured();
      await sceneGate;
    } else {
      authoritativeRefreshes += 1;
      next.sceneRevision = `${next.sceneRevision}:navigation-qa-refreshed`;
    }
    await route.fulfill({ response, json: next });
  });
  await page.route("**/api/events?after=*", async route => {
    await captured;
    const base = Math.max(bootstrap.country.worldVersion, ...scene.chunks.map(chunk => chunk.publishedVersion));
    const tasks = [...new Map(scene.chunks.flatMap(chunk => chunk.tasks).map(task => [task.id, task])).values()]
      .filter(task => task.visualKind === "BUILDING" && task.serviceRole !== "AIRPORT" && task.stage >= 3 && task.stage < 5);
    expect(tasks.length).toBeGreaterThanOrEqual(2);
    targetIds = tasks.slice(0, 2).map(task => task.id);
    const event = (offset: number, type: string, payload: RealtimeEvent["payload"]): RealtimeEvent => ({
      countryId: bootstrap.country.id, id: bootstrap.eventCursor + offset, worldVersion: base + offset,
      createdAt: "2026-09-05T00:00:00.000Z", type, payload,
    });
    let events: RealtimeEvent[] = [];
    if (phase === "initial") events = tasks.slice(0, 2).map((task, index) => event(index + 1, "task.status_changed", {
      taskId: task.id, cityId: scene.city.id, status: "TESTING", progress: 90, stage: 4, groundChanged: false,
    }));
    if (phase === "comment") events = [event(3, "task.comment_added", { taskId: targetIds[1], cityId: scene.city.id })];
    if (phase === "rename") events = [event(4, "task.renamed", { taskId: targetIds[0], cityId: scene.city.id })];
    phase = "done";
    replayBatches += 1;
    await route.fulfill({ json: events });
  });
  const loggingIn = login(page);
  await captured;
  await expect.poll(() => replayBatches).toBe(1);
  // The replay has reached React while Pixi still has no scene/runtime.
  await page.waitForTimeout(150);
  releaseScene();
  await loggingIn;
  const host = page.locator(".world-canvas");
  await expect.poll(async () => JSON.parse(await host.getAttribute("data-realtime-rendered-tasks") ?? "[]")).toEqual(
    expect.arrayContaining(targetIds.map(taskId => ({ taskId, stage: 4 }))),
  );
  // One cold read plus one revision-fenced read: the destination changed while
  // its original response was intentionally held. There is no per-event fanout.
  expect(reads.filter(path => path.endsWith("/scene"))).toHaveLength(2);
  const task = scene.chunks.flatMap(chunk => chunk.tasks).find(task => task.id === targetIds[0])!;
  await openTask(page, task.taskNumber);
  const firstTaskReads = reads.filter(isTaskRead).length;
  const baselineReads = reads.length;
  phase = "comment";
  const beforeCommentReplay = replayBatches;
  await context.setOffline(true);
  await page.waitForTimeout(1_100);
  await context.setOffline(false);
  await expect.poll(() => replayBatches, { timeout: 20_000 }).toBeGreaterThan(beforeCommentReplay);
  await page.waitForTimeout(300);
  // Reconnect performs one authoritative transport refresh; the comment itself
  // must not fan out task/bootstrap/viewport reads.
  expect(reads.slice(baselineReads)).toEqual([expect.stringMatching(/\/scene$/)]);
  await expect(page.locator("#task-title")).toHaveText(task.title);
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.getByRole("search").getByRole("textbox").fill(String(task.taskNumber));
  await expect(page.getByRole("option").first()).toBeVisible();
  await armTiming(page, "TASK");
  await page.getByRole("option").first().click();
  const warmTaskMs = await finishTiming(page);
  expect(warmTaskMs).toBeLessThan(100);
  expect(reads.filter(isTaskRead)).toHaveLength(firstTaskReads);
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();

  phase = "rename";
  failRefresh = true;
  await context.setOffline(true);
  await page.waitForTimeout(1_100);
  await context.setOffline(false);
  await expect(page.getByRole("alert")).toContainText("Не удалось обновить город", { timeout: 20_000 });
  const beforeRetry = authoritativeRefreshes;
  // Parent bootstrap/onReady changes must not masquerade as activation and
  // silently retry or dismiss the error before the user's action.
  await page.waitForTimeout(300);
  expect(authoritativeRefreshes).toBe(beforeRetry);
  await expect(page.getByRole("alert")).toContainText("Не удалось обновить город");
  await page.getByRole("alert").getByRole("button", { name: "Повторить" }).click();
  await expect(host).toHaveAttribute("data-city-scene-revision", /navigation-qa-refreshed$/);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(authoritativeRefreshes).toBe(beforeRetry + 1);
  expect(errors).toEqual([]);
  await info.attach("replay-cache-evidence", { body: Buffer.from(JSON.stringify({ targetIds, warmTaskMs, replayBatches, authoritativeRefreshes, reads }, null, 2)), contentType: "application/json" });
});

test("десять возвратов Планета–Город сохраняют камеру, renderer и не читают сцену", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror",error=>errors.push(error.message));
  const entry=await login(page),host=page.locator('.world-canvas');
  const retained=await host.locator('canvas').elementHandle();
  const camera=await host.evaluate(el=>[el.dataset.cameraWorldX,el.dataset.cameraWorldY,el.dataset.renderScale]);
  const reads:string[]=[];page.on('request',r=>{const path=new URL(r.url()).pathname;if(isDataRead(path)||path.endsWith('/select'))reads.push(path);});
  const samples:Array<{target:string;elapsedMs:number}>=[],started=Date.now();
  for(let i=0;i<10;i++)for(const target of ['PLANET','CITY'] as const) {
    await armTiming(page,target);
    await page.getByRole('navigation',{name:'Уровень карты'}).getByRole('button',{name:target==='PLANET'?'Планета':'Город',exact:true}).click();
    samples.push({target,elapsedMs:await finishTiming(page)});
    if(target==='PLANET')await expect(host).toHaveAttribute('data-animation-active','false');
    else {
      expect(await retained!.evaluate(el=>el===document.querySelector('.world-canvas canvas'))).toBe(true);
      expect(await host.evaluate(el=>[el.dataset.cameraWorldX,el.dataset.cameraWorldY,el.dataset.renderScale])).toEqual(camera);
    }
  }
  expect(reads.filter(p=>!p.endsWith('/planet-atlas'))).toEqual([]);
  expect(reads.length).toBeLessThanOrEqual(Math.ceil((Date.now()-started)/PLANET_REVALIDATE_MS));
  expect(errors).toEqual([]);expect(entry.loginToFirstFrameMs).toBeLessThan(3000);
  for(const sample of samples)expect(sample.elapsedMs,JSON.stringify(sample)).toBeLessThan(500);
  await info.attach('warm-navigation-evidence',{body:Buffer.from(JSON.stringify({entry,samples,reads})),contentType:'application/json'});
});
