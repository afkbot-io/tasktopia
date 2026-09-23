import { expect, test } from '@playwright/test';

test('карточка и компактное меню сохраняют функции, а настройки реально ограничивают рендер',async({page},info)=>{
  test.setTimeout(90000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await page.getByLabel('Email').fill('demo@tasktopia.local');await page.getByLabel('Пароль').fill('tasktopia-demo');
  await page.getByRole('button',{name:'Открыть страну',exact:true}).click();
  await expect(page.locator('.planet-atlas')).toHaveAttribute('data-planet-ready','true',{timeout:45000});
  await expect(page.getByRole('button',{name:'План',exact:true})).toHaveCount(0);
  await page.getByRole('navigation',{name:'Уровень карты'}).getByRole('button',{name:'Город',exact:true}).click();
  const world=page.locator('.world-canvas');await expect(world).toHaveAttribute('data-loading','false',{timeout:45_000});
  await page.locator('.world-preferences:visible > summary').click();
  await page.locator('.world-preferences:visible').getByLabel('Детализация').selectOption('ECONOMY');
  await expect(world).toHaveAttribute('data-frame-limit','30');await expect(world).toHaveAttribute('data-world-quality','ECONOMY');
  expect(Number(await world.getAttribute('data-world-pixel-ratio'))).toBeLessThanOrEqual(1);
  await page.locator('.world-preferences:visible').getByLabel('Уменьшить движение').check();await expect(world).toHaveAttribute('data-animation-active','false');
  await expect(page.getByText('Освещение',{exact:true})).toHaveCount(0);
  await expect(world).toHaveAttribute('data-light-phase','DAY');
  await page.locator('.world-preferences:visible').getByLabel('Жизнь города').uncheck();await expect(world).toHaveAttribute('data-city-life-event','');
  await page.locator('.world-preferences:visible').getByLabel('Детализация').selectOption('NORMAL');await expect(world).toHaveAttribute('data-frame-limit','60');
  await page.locator('.world-preferences:visible').getByLabel('Уменьшить движение').uncheck();await expect(world).toHaveAttribute('data-animation-active','true');
  await page.locator('.world-preferences:visible > summary').click();
  await page.getByRole('textbox',{name:'Поиск здания по номеру или названию'}).fill('1');await page.locator('.task-search-results button').first().click();
  await page.getByRole('tab',{name:'Задача',exact:true}).waitFor();
  for(const name of ['Материалы','Обсуждение','История','Задача']) {
    await page.getByRole('tab',{name:new RegExp(`^${name}`)}).first().click();
    await expect(page.locator('.task-tab-content:visible')).toHaveCount(1);
  }
  await page.screenshot({path:'.builder/evidence/inspector-ready.png'});
  await page.setViewportSize({width:390,height:844});
  const modal=page.getByRole('dialog').first();expect((await modal.boundingBox())!.width).toBeLessThanOrEqual(390);
  await expect(page.getByRole('tab',{name:'История',exact:true})).toBeInViewport();
  await page.getByRole('tab',{name:'Задача',exact:true}).focus();await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab',{name:/^Материалы/}).first()).toBeFocused();
  await page.keyboard.press('Escape');await expect(page.locator('.task-inspector')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.locator('.world-menu > summary').click();await page.getByRole('button',{name:'Города',exact:true}).click();
  await expect(page.locator('.city-directory')).toBeVisible();
  await expect(page.locator('.city-directory .plan-row > button').filter({hasText:'Riverside'}).first()).toBeVisible();
  await page.screenshot({path:'.builder/evidence/directory-mobile.png'});
  expect(errors).toEqual([]);
  await info.attach('quality',{body:Buffer.from(JSON.stringify(await world.evaluate(el=>({quality:el.dataset.worldQuality,fps:el.dataset.frameLimit,lifeSites:el.dataset.cityLifeSites,parking:el.dataset.parkingLots})))),contentType:'application/json'});
});
