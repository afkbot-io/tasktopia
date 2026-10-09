import { test, type Page, type TestInfo } from '@playwright/test';

/** Keep the full CSS viewport, NORMAL density, real renderer and every fixed
 * physics step. A smaller raster buffer bounds software GPU cost in CI; native
 * visual and real-clock performance cases retain their original device scale. */
export function clockSceneTest(name: string, body: (args: { page: Page }, info: TestInfo) => Promise<void>) {
  const dpr = Number(process.env.E2E_SCENE_DPR ?? (process.env.CI ? '0.25' : '1'));
  if (!Number.isFinite(dpr) || dpr < .25 || dpr > 2) throw new Error('Invalid clock scene raster scale');
  test.describe(name, () => {
    test.use({ deviceScaleFactor: dpr });
    test(name, async ({ page }, info) => {
      const actualDpr = await page.evaluate(() => devicePixelRatio);
      if (actualDpr !== dpr) throw new Error(`Clock scene raster scale ${actualDpr}, expected ${dpr}`);
      await info.attach('clock-renderer-workload', { body: JSON.stringify({ deviceScaleFactor: actualDpr, fixedStep: 'unchanged', sceneDensity: 'unchanged' }), contentType: 'application/json' });
      await body({ page }, info);
    });
  });
}

/** The simulation clock jumps minutes; heartbeat deadlines must stay outside
 * that synthetic horizon. Handshake still comes from the real owned server,
 * and every task/MCP payload remains untouched. Fresh-opening tests use normal
 * unmodified WS time; these tests qualify background animation and physics. */
export async function installSceneClock(page: Page) {
  await page.addInitScript(() => {
    const random = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = ((array: ArrayBufferView<ArrayBuffer>) => {
      if (array instanceof Uint32Array && array.length === 1) { array[0] = 37; return array; }
      return random(array);
    }) as Crypto['getRandomValues'];
  });
  await page.route('**/socket.io/?*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() !== 'GET' || url.searchParams.get('transport') !== 'polling' || url.searchParams.has('sid')) return route.continue();
    const response = await route.fetch(), body = await response.text();
    if (!body.startsWith('0{')) return route.fulfill({ response });
    const handshake = JSON.parse(body.slice(1)); handshake.pingInterval = 3_600_000; handshake.pingTimeout = 3_600_000;
    await route.fulfill({ response, body: `0${JSON.stringify(handshake)}` });
  });
  await page.clock.install();
}
