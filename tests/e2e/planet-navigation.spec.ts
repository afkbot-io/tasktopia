import { openMapCity } from "./map-navigation";
import { expect, test } from '@playwright/test';

for (const dpr of [1, 2]) test.describe(`подписи городов DPR ${dpr}`, () => {
  test.use({ deviceScaleFactor: dpr });
  test('подписи следуют географии, исчезают за экраном и возвращаются без запросов', async ({ page }) => {
    await page.request.post('/api/auth/login', { data: { email: 'demo@tasktopia.local', password: 'tasktopia-demo' } });
    await page.goto('/');
    const planet = page.locator('.planet-atlas');
    await expect(planet).toHaveAttribute('data-planet-ready', 'true');
    await expect(page.locator('.planet-city-label')).toHaveCount(0);
    await page.locator('.planet-city-targets [data-city-id]').first().click();
    await expect(planet).toHaveAttribute('data-globe-zoom', '3.00');
    const labels = page.locator('.planet-city-label');
    const original = await labels.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-city-id')));
    expect(original.length).toBeGreaterThan(0);
    const reads: string[] = [];
    page.on('request', request => { if (/\/planet-atlas|\/overview|\/scene|\/viewport|\/chunks\//.test(request.url())) reads.push(request.url()); });
    const svg = planet.locator('svg[role="group"]');
    await svg.focus();
    // Keyboard movement is deterministic and shares the actual camera reducer.
    for (let i = 0; i < 8; i++) await page.keyboard.press('Shift+ArrowRight');
    await expect(labels).toHaveCount(0);
    for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowLeft');
    // The camera clamps at the boundary; restore around the original city.
    for (let i = 0; i < 6 && await labels.count() === 0; i++) await page.keyboard.press('ArrowRight');
    await expect.poll(() => labels.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-city-id')))).toEqual(original);
    expect(reads).toEqual([]);
  });
});

test('районы различают загрузку, пустой ответ и ошибку с повтором', async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { email: 'demo@tasktopia.local', password: 'tasktopia-demo' } });
  let fail = true;
  await page.route('**/api/plan/cities/*/districts', route => fail
    ? route.fulfill({ status: 503, json: { error: { code: 'UNAVAILABLE', message: 'Районы временно недоступны' } } })
    : route.fulfill({ json: [] }));
  await page.goto('/');
  await openMapCity(page);
  await expect(page.locator('.world-canvas')).toHaveAttribute('data-city-scene-commit', 'atomic');
  await page.locator('.header-city').click();
  const directory = page.getByRole('complementary', { name: 'Районы города' });
  await expect(directory.getByRole('alert')).toBeVisible();
  fail = false;
  await directory.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(directory.getByText('В городе пока нет районов')).toBeVisible();
  await expect(directory.getByText('Загружаем районы…')).toHaveCount(0);
  await expect(directory.getByRole('alert')).toHaveCount(0);
});

test('список на 150 городов загружается страницами и ищет город на последней странице', async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { email: 'demo@tasktopia.local', password: 'tasktopia-demo' } });
  const original = (await (await page.request.get('/api/plan/cities-page?limit=50')).json()).items[0];
  const cities = Array.from({length:150}, (_,index)=>({...original,id:`directory-${index}`,name:`Город ${String(index+1).padStart(3,'0')}`}));
  let reads=0;
  await page.route('**/api/plan/cities-page?*', route=>{
    reads++;
    const cursor=Number(new URL(route.request().url()).searchParams.get('cursor')??0);
    return route.fulfill({json:{items:cities.slice(cursor,cursor+50),nextCursor:cursor+50<150?String(cursor+50):null}});
  });
  await page.goto('/');
  await page.locator('.world-menu > summary').click();
  await page.getByRole('button',{name:'Города',exact:true}).click();
  const directory=page.getByRole('complementary',{name:'Города'});
  await expect(directory.locator('.plan-row')).toHaveCount(150);
  expect(reads).toBe(3);
  await directory.getByRole('textbox',{name:'Найти город'}).fill('Город 150');
  await expect(directory.locator('.plan-row')).toHaveCount(1);
  await expect(directory.locator('.plan-row').getByRole('button').first()).toContainText('Город 150');
  await directory.getByRole('textbox',{name:'Найти город'}).fill('Не существует');
  await expect(directory.getByText('Подходящих городов нет')).toBeVisible();
  expect(reads).toBe(3);
});
