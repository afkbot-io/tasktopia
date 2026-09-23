import { expect, test } from '@playwright/test';
test.skip(process.env.E2E_NAVIGATION_FIXTURE!=='true','Нужен небольшой изолированный мир навигации');
test('отмена медленного входа и быстрый выбор другого проекта сохраняют единую сессию',async({page})=>{
  test.setTimeout(90_000);
  const errors:string[]=[],failed:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{if(r.status()>=400)failed.push(`${r.status()} ${new URL(r.url()).pathname}`);});
  await page.goto('/');await page.getByLabel('Email').fill('world-validation@tasktopia.local');await page.getByLabel('Пароль').fill('tasktopia-world-validation');
  await page.getByRole('button',{name:'Открыть страну',exact:true}).click();
  const planet=page.locator('.planet-atlas');await expect(planet).toHaveAttribute('data-planet-ready','true',{timeout:45_000});
  failed.length=0; // The anonymous bootstrap 401 precedes this authenticated journey.
  const bootstrap=await page.request.get('/api/bootstrap').then(r=>r.json());
  const initialId=bootstrap.country.id;
  const foreign=page.locator(`.planet-city-targets [data-country-id]:not([data-country-id="${initialId}"])`).first();
  const foreignId=(await foreign.getAttribute('data-country-id'))!,cityId=(await foreign.getAttribute('data-city-id'))!;
  let release!:()=>void;const hold=new Promise<void>(resolve=>{release=resolve;});let caught=false;
  await page.route(`**/countries/${foreignId}/cities/${cityId}/scene`,async route=>{caught=true;await hold;await route.continue();});
  await foreign.press('Enter');await expect.poll(()=>caught).toBe(true);
  await page.getByRole('button',{name:'Вернуться на планету',exact:true}).click();
  await expect(page.locator('.map-level-transition')).toHaveCount(0);
  await expect(planet).toBeVisible();
  const home=page.locator(`.planet-city-targets [data-country-id="${initialId}"]`).first();
  await home.press('Enter');release();
  const world=page.locator('.world-canvas');await expect(world).toHaveAttribute('data-city-scene-commit','atomic',{timeout:45_000});
  await expect(world).toHaveAttribute('data-loading','false');
  const session=await page.request.get('/api/bootstrap').then(r=>r.json());expect(session.country.id).toBe(initialId);
  await expect(page.locator('.country-title-button strong')).toHaveText(session.country.name);
  await expect(page.locator('.map-level-transition')).toHaveCount(0);
  expect(errors).toEqual([]);expect(failed).toEqual([]);
});
