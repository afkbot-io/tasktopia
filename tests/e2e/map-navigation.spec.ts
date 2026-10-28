import { expect, test, type Page } from '@playwright/test';
import type { BootstrapDto } from '../../src/shared/contracts';
import { openMapCity } from './map-navigation';

const cityId = '11111111-1111-4111-8111-111111111111';
const countryId = '22222222-2222-4222-8222-222222222222';
const cityMarkup = `<nav aria-label="Уровень карты"><button aria-current="page">Город</button></nav>
  <div class="world-canvas" data-loading="true" style="width:200px;height:100px">Готовим карту…</div>`;
const counters = `<script>
  document.body.dataset.keydowns = '0'; document.body.dataset.clicks = '0'; document.body.dataset.entries = '0';
  document.addEventListener('keydown', () => { document.body.dataset.keydowns = String(Number(document.body.dataset.keydowns) + 1); });
  document.addEventListener('click', () => { document.body.dataset.clicks = String(Number(document.body.dataset.clicks) + 1); });
</script>`;
async function fixture(page: Page, query: string, body: string) {
  await page.route(url => url.pathname === '/', route => route.fulfill({ contentType: 'text/html',
    body: `<!doctype html><html><body><main id="mount">${body}</main>${counters}</body></html>` }));
  await page.goto('/' + query);
}
function observeApiGets(page: Page) {
  const originalGet = page.request.get, get = originalGet.bind(page.request), calls: string[] = [];
  // Browser routing does not intercept APIRequestContext. Observe its public
  // method while preserving the real request, response and receiver.
  page.request.get = (...args) => { calls.push(args[0]); return get(...args); };
  return { calls, restore: () => { page.request.get = originalGet; } };
}

test('CITY deep-link restoration ignores the transient unready PLANET without issuing navigation', async ({ page }) => {
  const api = observeApiGets(page);
  try {
    await fixture(page, `?countryId=${countryId}&cityId=${cityId}`, '<div class="planet-atlas" data-planet-ready="false">Планета</div>');
    await expect(page.locator('.planet-atlas')).toHaveAttribute('data-planet-ready', 'false');
    const opening = openMapCity(page);
    // Public DOM fixture models the real bootstrap/deep-link transition. No
    // production hook or ready terrain/frame is supplied to the helper.
    await page.locator('#mount').evaluate((node, html) => { node.innerHTML = html; }, cityMarkup);
    await opening;
    await expect(page).toHaveURL(url => url.searchParams.get('countryId') === countryId && url.searchParams.get('cityId') === cityId);
    await expect(page.locator('.world-canvas')).toHaveAttribute('data-loading', 'true');
    await expect(page.locator('.world-canvas')).not.toHaveAttribute('data-city-scene-commit', 'atomic');
    await expect(page.locator('body')).toHaveAttribute('data-keydowns', '0');
    await expect(page.locator('body')).toHaveAttribute('data-clicks', '0');
    await expect(page.locator('body')).toHaveAttribute('data-entries', '0');
    expect(api.calls).toEqual([]);
  } finally { api.restore(); }
});

test('plain PLANET entry waits for readiness and returns while first-frame terrain remains held', async ({ page }) => {
  expect((await page.request.post('/api/auth/login', { data: {
    email: process.env.E2E_CITY_EMAIL ?? 'demo@tasktopia.local',
    password: process.env.E2E_CITY_PASSWORD ?? 'tasktopia-demo',
  } })).status()).toBe(200);
  // Resolve the real fixture destination before observing helper requests.
  const response = await page.request.get('/api/bootstrap');
  expect(response.status()).toBe(200);
  const bootstrap = await response.json() as BootstrapDto;
  expect(bootstrap.initialCity?.id).toBeTruthy();
  const entryCityId = bootstrap.initialCity!.id;
  let terrainStarted = false, releaseTerrain!: () => void;
  const terrainGate = new Promise<void>(resolve => { releaseTerrain = resolve; }), deliveries: Promise<void>[] = [];
  const terrainPattern = '**/map-navigation-fixture-terrain.svg';
  await page.route(terrainPattern, route => {
    terrainStarted = true;
    const delivery = terrainGate.then(() => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' }));
    deliveries.push(delivery); return delivery;
  });
  const terrainCity = cityMarkup + '<img src="/map-navigation-fixture-terrain.svg" onload="document.querySelector(\'.world-canvas\').dataset.citySceneCommit=\'atomic\'">';
  const api = observeApiGets(page);
  try {
    await fixture(page, '', `<div class="planet-atlas" data-planet-ready="false">Планета
      <div class="planet-city-targets"><button data-city-id="${entryCityId}">Город на планете</button></div></div>
      <script>document.querySelector('[data-city-id]').addEventListener('click', () => {
        document.body.dataset.entries = String(Number(document.body.dataset.entries) + 1);
        document.body.dataset.readyAtEntry = document.querySelector('.planet-atlas').dataset.planetReady;
        document.querySelector('#mount').innerHTML = ${JSON.stringify(terrainCity)};
      });</script>`);
    const opening = openMapCity(page);
    await expect(page.locator('.planet-atlas')).toHaveAttribute('data-planet-ready', 'false');
    await expect(page.locator('body')).toHaveAttribute('data-keydowns', '0');
    await expect(page.locator('body')).toHaveAttribute('data-entries', '0');
    expect(api.calls).toEqual([]);
    await page.locator('.planet-atlas').evaluate(node => { (node as HTMLElement).dataset.planetReady = 'true'; });
    await opening;
    await expect.poll(() => terrainStarted).toBe(true);
    await expect(page.locator('body')).toHaveAttribute('data-ready-at-entry', 'true');
    await expect(page.locator('body')).toHaveAttribute('data-keydowns', '1');
    await expect(page.locator('body')).toHaveAttribute('data-entries', '1');
    expect(api.calls).toEqual(['/api/bootstrap']);
    await expect(page.locator('.world-canvas')).toHaveAttribute('data-loading', 'true');
    await expect(page.locator('.world-canvas')).not.toHaveAttribute('data-city-scene-commit', 'atomic');
    releaseTerrain(); await Promise.all(deliveries);
    await expect(page.locator('.world-canvas')).toHaveAttribute('data-city-scene-commit', 'atomic');
  } finally { api.restore(); releaseTerrain(); await Promise.all(deliveries); await page.unroute(terrainPattern); }
});
