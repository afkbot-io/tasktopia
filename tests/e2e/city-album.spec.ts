import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { BootstrapDto } from '../../src/shared/contracts';
import type { CityAlbumPageDto, CityDevelopmentFacts } from '../../src/shared/city-album';
import { openMapCity } from './map-navigation';
async function enter(page: Page) {
  expect((await page.request.post('/api/auth/login', { data: { email: process.env.E2E_CITY_EMAIL ?? 'demo@tasktopia.local', password: process.env.E2E_CITY_PASSWORD ?? 'tasktopia-demo' } })).status()).toBe(200);
  const bootstrap = await (await page.request.get('/api/bootstrap')).json() as BootstrapDto;
  await page.goto('/'); await openMapCity(page); await expect(page.locator('.world-canvas')).toHaveAttribute('data-city-scene-commit', 'atomic');
  return bootstrap;
}
async function open(page: Page) {
  await page.getByLabel('Фильтры', { exact: true }).click(); await page.getByRole('button', { name: 'Альбом города', exact: true }).click();
  return page.getByRole('dialog', { name: 'Альбом города' });
}
test('touch: real legacy milestones page independently of the map and restore focus', async ({ page }, info) => {
  const bootstrap = await enter(page), errors: string[] = [], scenes: string[] = [];
  page.on('pageerror', error => errors.push(error.message)); page.on('request', request => { if (/\/scene(?:\?|$)/.test(request.url())) scenes.push(request.url()); });
  const endpoint = `/api/countries/${bootstrap.country.id}/cities/${bootstrap.initialCity!.id}/album`;
  const native = await (await page.request.get(`${endpoint}?limit=20`)).json() as CityAlbumPageDto;
  const dialog = await open(page); await expect(dialog.locator('.city-album-milestones > li')).toHaveCount(native.items.length);
  if (native.nextCursor) { const first = await dialog.locator('.city-album-milestones').innerText(); await dialog.getByRole('button', { name: 'Далее', exact: true }).click();
    await expect(dialog.locator('.city-album-milestones > li').first()).toBeVisible(); expect(await dialog.locator('.city-album-milestones').innerText()).not.toBe(first);
    await dialog.getByRole('button', { name: 'Назад', exact: true }).click(); await expect(dialog.locator('.city-album-milestones')).toHaveText(first.replace(/\s+/g, ' '), { useInnerText: true });
  }
  expect(scenes).toEqual([]); expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath('city-album-legacy.png') }); await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(page.getByLabel('Фильтры', { exact: true })).toBeFocused();
});
test('touch: actual comparison contract, deleted object, failure retry and 320px keyboard layout', async ({ page }, info) => {
  const bootstrap = await enter(page), countryId = bootstrap.country.id, cityId = bootstrap.initialCity!.id;
  // Controlled read-only contract fixture; these figures are not stored as
  // historical city facts and are not used in the performance qualification.
  const before: CityDevelopmentFacts = { tasks: 199, buildings: 150, parks: 49, completedTasks: 159, occupiedBlocks: 20, activeDistricts: 8, completedDistricts: 6, readyServices: [] };
  const data: CityAlbumPageDto = { kind: 'city.album-page', version: 1, countryId, cityId, nextCursor: null, items: [{
    eventId: 999999, type: 'task.deleted', at: new Date().toISOString(), source: 'event-with-development', districtId: null,
    task: { id: 'deleted', taskNumber: 42, title: 'Очень длинное название старого городского парка у набережной', exists: false },
    before, after: { ...before, tasks: 198, parks: 48 },
  }] };
  let fail = true;
  await page.route(`**/api/countries/${countryId}/cities/${cityId}/album?*`, route => {
    if (fail) { return route.fulfill({ status: 503, json: { message: 'Альбом временно недоступен' } }); }
    return route.fulfill({ json: data });
  });
  await page.setViewportSize({ width: 320, height: 640 }); const dialog = await open(page);
  await expect(dialog.getByRole('alert')).toContainText('Альбом временно недоступен'); fail = false; await dialog.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(dialog.getByRole('table', { name: 'Как изменился город' })).toBeVisible(); await expect(dialog.getByText('Объект удалён', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Очень длинное/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include('.city-album').analyze()).violations.filter(issue => ['serious', 'critical'].includes(issue.impact ?? ''))).toEqual([]);
  await page.screenshot({ path: info.outputPath('city-album-320-comparison.png') }); await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(page.getByLabel('Фильтры', { exact: true })).toBeFocused();
});
