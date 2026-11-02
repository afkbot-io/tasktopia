import { createHash } from 'node:crypto';
import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';
import type { Cell, Rect } from '../../src/shared/contracts';
import type { CitySceneDto } from '../../src/shared/city-scene-contract';
import { decodeCitySceneWire, encodeCitySceneWire } from '../../src/shared/city-scene-wire';
import { cameraTerrainPadding } from '../../src/client/camera-terrain-padding';
import { openMapCity } from './map-navigation';

const cellPixels = 8;
const key = (x: number, y: number) => `${x},${y}`;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const host = (page: Page) => page.locator('.world-canvas');
const canvas = (page: Page) => page.locator("canvas[aria-label='Интерактивная карта города']");
const pose = (page: Page) => host(page).evaluate(node => ({
  x: Number((node as HTMLElement).dataset.cameraWorldX), y: Number((node as HTMLElement).dataset.cameraWorldY),
  scale: Number((node as HTMLElement).dataset.renderScale),
}));

async function presented(page: Page) {
  await expect(host(page)).toHaveAttribute('data-camera-presentation-pending', 'false', { timeout: 15_000 });
  await expect(host(page)).toHaveAttribute('data-loading', 'false');
  await expect(host(page)).not.toHaveAttribute('data-load-error', 'true');
  await expect(host(page)).toHaveAttribute('data-city-critical-ground-ready', 'true');
  await expect(host(page)).toHaveAttribute('data-camera-padding-visible-untextured', '0');
  await expect(host(page)).toHaveAttribute('data-camera-padding-target-unbaked', '0');
}

function navigationBounds(scene: CitySceneDto): Rect {
  const bounds = { ...scene.city.bounds };
  const include = (p: Cell) => {
    bounds.minX = Math.min(bounds.minX, p.x - 4); bounds.maxX = Math.max(bounds.maxX, p.x + 4);
    bounds.minY = Math.min(bounds.minY, p.y - 4); bounds.maxY = Math.max(bounds.maxY, p.y + 4);
  };
  for (const airport of scene.airports ?? []) if (airport.plan) {
    const r = airport.plan.airfield; include({ x: r.minX, y: r.minY }); include({ x: r.maxX, y: r.maxY });
  }
  if (scene.railway) {
    include({ x: scene.railway.platform.x - 20, y: scene.railway.platform.y - 20 });
    include({ x: scene.railway.platform.x + 3, y: scene.railway.platform.y + 3 });
  }
  const size = scene.chunkSize;
  return { minX: Math.floor(bounds.minX / size) * size, minY: Math.floor(bounds.minY / size) * size,
    maxX: (Math.floor(bounds.maxX / size) + 1) * size - 1, maxY: (Math.floor(bounds.maxY / size) + 1) * size - 1 };
}

async function panTo(page: Page, target: Cell) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const box = (await canvas(page).boundingBox())!, view = await pose(page);
    const dx = (view.x - target.x) * cellPixels * view.scale, dy = (view.y - target.y) * cellPixels * view.scale;
    if (Math.abs(dx) < box.width * .2 && Math.abs(dy) < box.height * .2) break;
    const fraction = Math.min(1, box.width * .3 / Math.max(1, Math.abs(dx)), box.height * .3 / Math.max(1, Math.abs(dy)));
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx * fraction, box.y + box.height / 2 + dy * fraction, { steps: 6 });
    await page.mouse.up();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await presented(page);
    const after = await pose(page);
    if (after.x === view.x && after.y === view.y) break; // A real navigation clamp is allowed; coverage below is still mandatory.
  }
}

async function verifyFrame(page: Page, scene: CitySceneDto, phase: string, info: TestInfo, webkit: boolean) {
  await presented(page);
  const view = await pose(page), dimensions = await canvas(page).evaluate(node => ({ width: node.clientWidth, height: node.clientHeight }));
  expect(Object.values(view).every(Number.isFinite) && view.scale > 0).toBe(true);
  const position = { x: dimensions.width / 2 - view.x * cellPixels * view.scale,
    y: dimensions.height / 2 - view.y * cellPixels * view.scale };
  const chunkPixels = scene.chunkSize * cellPixels * view.scale, visible: Array<[number, number]> = [];
  // Independent positive-area screen intersection, without a city/navigation clamp.
  for (let y = Math.floor(-position.y / chunkPixels); y < Math.ceil((dimensions.height - position.y) / chunkPixels); y++) {
    for (let x = Math.floor(-position.x / chunkPixels); x < Math.ceil((dimensions.width - position.x) / chunkPixels); x++) visible.push([x, y]);
  }
  const residents = new Set(scene.chunks.map(chunk => key(chunk.chunkX, chunk.chunkY)));
  const padding = new Set(cameraTerrainPadding(position, view.scale, dimensions, residents, cellPixels, scene.chunkSize).map(([x, y]) => key(x, y)));
  expect(visible.filter(([x, y]) => !residents.has(key(x, y)) && !padding.has(key(x, y)))).toEqual([]);
  expect([...padding].filter(id => residents.has(id))).toEqual([]);
  const nav = navigationBounds(scene);
  const gap = visible.filter(([x, y]) => !residents.has(key(x, y)) && x * scene.chunkSize >= nav.minX && y * scene.chunkSize >= nav.minY
    && (x + 1) * scene.chunkSize - 1 <= nav.maxX && (y + 1) * scene.chunkSize - 1 <= nav.maxY);
  expect(gap.length, 'The controlled transport envelope must expose a visible nonresident chunk inside navigation bounds').toBeGreaterThan(0);
  const regions = gap.map(([x, y]) => {
    const left = Math.max(16, x * chunkPixels + position.x), top = Math.max(64, y * chunkPixels + position.y);
    const right = Math.min(dimensions.width - 16, (x + 1) * chunkPixels + position.x), bottom = Math.min(dimensions.height - 48, (y + 1) * chunkPixels + position.y);
    return { chunk: key(x, y), x: (left + right) / 2, y: (top + bottom) / 2, width: Math.min(32, right - left), height: Math.min(32, bottom - top) };
  }).filter(region => region.width >= 16 && region.height >= 16);
  expect(regions.length, 'At least one actual transport-gap pixel region must be visible away from controls').toBeGreaterThan(0);
  const png = await canvas(page).screenshot();
  await info.attach(`terrain-${phase}.png`, { body: png, contentType: 'image/png' });
  const pixels = await page.evaluate(async ({ encoded, regions, dimensions, tolerance }) => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))], { type: 'image/png' }));
    const surface = new OffscreenCanvas(bitmap.width, bitmap.height), context = surface.getContext('2d')!;
    context.drawImage(bitmap, 0, 0); bitmap.close();
    const ratioX = surface.width / dimensions.width, ratioY = surface.height / dimensions.height;
    return regions.map(region => {
      const x = Math.round((region.x - region.width / 2) * ratioX), y = Math.round((region.y - region.height / 2) * ratioY);
      const width = Math.max(1, Math.floor(region.width * ratioX)), height = Math.max(1, Math.floor(region.height * ratioY));
      const data = context.getImageData(x, y, width, height).data; let clear = 0, transparent = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3]! < 250) transparent++;
        if (Math.abs(data[i]! - 16) <= tolerance && Math.abs(data[i + 1]! - 29) <= tolerance && Math.abs(data[i + 2]! - 32) <= tolerance) clear++;
      }
      return { chunk: region.chunk, samples: data.length / 4, clearFraction: clear / (data.length / 4), transparentFraction: transparent / (data.length / 4) };
    });
  }, { encoded: png.toString('base64'), regions, dimensions, tolerance: webkit ? 4 : 2 });
  await info.attach(`coverage-${phase}`, { body: JSON.stringify({ controlledCase: 'HTTP_TRANSPORT_ENVELOPE_ONLY', view, dimensions, visible, residents: [...residents], padding: [...padding], gap, regions, pixels }), contentType: 'application/json' });
  for (const region of pixels) {
    expect(region.transparentFraction, `${region.chunk}: HTML/transparent blank`).toBe(0);
    expect(region.clearFraction, `${region.chunk}: unpainted Pixi clear-color rectangle`).toBeLessThan(.02);
  }
}

test('transport boundary outside resident scene keeps visible terrain covered after native pan', async ({ page, baseURL, browserName, isMobile }, info) => {
  test.setTimeout(90_000);
  expect(baseURL).toBeTruthy();
  const origin = new URL(baseURL!);
  expect(['127.0.0.1', 'localhost']).toContain(origin.hostname); expect(origin.protocol).toBe('http:');
  const errors: string[] = [], reads: string[] = [], deliveries: Promise<void>[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', request => errors.push(`${new URL(request.url()).pathname}: ${request.failure()?.errorText}`));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  page.on('request', request => { const path = new URL(request.url()).pathname; if (request.method() === 'GET' && /\/scene$|\/world\/viewport|\/chunks\//.test(path)) reads.push(path); });
  let controlled: CitySceneDto | undefined;
  const scenePattern = '**/api/countries/*/cities/*/scene';
  const transportEnvelope = (route: Route) => {
    const delivery = (async () => {
      // Playwright's APIResponse decoder cannot inspect Firefox's Zstd body.
      const response = await route.fetch({ headers: { ...route.request().headers(), 'accept-encoding': 'identity' } }); expect(response.status()).toBe(200);
      const envelope = await response.json(), scene = decodeCitySceneWire(envelope), original = scene.railway;
      expect(original?.axis, 'The owned local fixture must provide its real vertical railway').toBe('vertical');
      const immutable = () => hash([scene.city, scene.chunks, scene.completedDistrictSnapshots, scene.airports]);
      const before = immutable(), x = (Math.max(...scene.chunks.map(chunk => chunk.chunkX)) + 1) * scene.chunkSize + 4;
      const access = original!.access.map(point => ({ ...point })), last = access.at(-1)!;
      expect(last).toEqual(original!.platform); expect(x - last.x).toBeGreaterThan(0); expect(x - last.x).toBeLessThanOrEqual(512);
      for (let column = last.x + 1; column <= x; column++) access.push({ x: column, y: original!.platform.y });
      scene.railway = { ...original!, from: { ...original!.from, x }, to: { ...original!.to, x }, platform: { ...original!.platform, x }, access };
      expect(immutable(), 'Only transport metadata may change; no mocked terrain/tasks/resident geometry').toBe(before);
      scene.sceneRevision = hash([scene.sceneRevision, scene.railway]);
      controlled = scene;
      const headers: Record<string, string> = { ...response.headers(), 'cache-control': 'private, no-store' };
      delete headers['content-length']; delete headers['content-encoding']; delete headers.etag;
      await info.attach('controlled-transport-envelope', { body: JSON.stringify({ kind: 'HTTP_TRANSPORT_ENVELOPE_ONLY', naturalFixtureReproductionClaimed: false,
        immutableResidentHash: before, stationId: original!.stationId, originalPlatform: original!.platform, controlledPlatform: scene.railway.platform }), contentType: 'application/json' });
      await route.fulfill({ response, headers, json: envelope.kind === 'city.scene.compact' ? encodeCitySceneWire(scene) : scene });
    })();
    deliveries.push(delivery); return delivery;
  };
  await page.route(scenePattern, transportEnvelope);
  try {
    await page.clock.setFixedTime(new Date('2026-09-07T09:00:00Z'));
    expect((await page.request.post('/api/auth/login', { data: { email: process.env.E2E_CITY_EMAIL ?? 'demo@tasktopia.local', password: process.env.E2E_CITY_PASSWORD ?? 'tasktopia-demo' } })).status()).toBe(200);
    await page.goto('/', { waitUntil: 'domcontentloaded' }); await openMapCity(page);
    await expect(host(page)).toHaveAttribute('data-city-scene-commit', 'atomic', { timeout: 30_000 });
    expect(controlled).toBeDefined();
    const scene = controlled!, target = { x: scene.railway!.platform.x + 1, y: scene.railway!.platform.y - 12 };
    await expect(host(page)).toHaveAttribute('data-city-railway-stage', String(scene.railway!.stage));
    const renderedRailway = JSON.parse((await host(page).getAttribute('data-city-railway-geometry'))!);
    expect(renderedRailway.platform).toEqual(scene.railway!.platform);
    const beforePan = await pose(page);
    await panTo(page, target);
    const afterPan = await pose(page);
    expect(Math.hypot(afterPan.x - beforePan.x, afterPan.y - beforePan.y), 'Real pointer input must move the camera').toBeGreaterThan(1);
    await verifyFrame(page, scene, isMobile ? 'iphone' : 'desktop', info, browserName === 'webkit');
    if (!isMobile) {
      await page.setViewportSize({ width: 1440, height: 1100 });
      await panTo(page, target); await verifyFrame(page, scene, 'tall', info, browserName === 'webkit');
    }
    expect(reads.filter(path => path.endsWith('/scene'))).toHaveLength(1);
    expect(reads.filter(path => /\/world\/viewport|\/chunks\//.test(path))).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(deliveries);
    await page.unroute(scenePattern, transportEnvelope);
  }
});
