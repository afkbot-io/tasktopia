import { expect, test, type Page } from '@playwright/test';
async function login(page:Page){await page.goto('/');await page.getByLabel('Email').fill('demo@tasktopia.local');await page.getByLabel('Пароль').fill('tasktopia-demo');await page.getByRole('button',{name:'Открыть страну',exact:true}).click();}

test('ошибка данных города оставляет планету доступной для повторного входа',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await login(page);
 await expect(page.locator('.planet-atlas')).toHaveAttribute('data-planet-ready','true');
 let attempts=0;await page.route('**/api/countries/*/cities/*/scene',async route=>{attempts++;if(attempts===1)await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Проверочная временная ошибка'})});else await route.continue();});
 const city=page.locator('.planet-city-targets [data-city-id]').first();await city.press('Enter');
 await expect(page.locator('.map-transition-error')).toBeVisible();await expect(page.locator('.planet-atlas')).toBeVisible();
 await city.press('Enter');await expect(page.locator('.world-canvas')).toHaveAttribute('data-city-scene-commit','atomic',{timeout:45000});
 expect(attempts).toBe(2);expect(errors).toEqual([]);
});

test('таймаут декодера города освобождает обещание Pixi и разрешает повтор',async({page})=>{
 test.setTimeout(75000);
 await page.addInitScript(()=>{const decode=HTMLImageElement.prototype.decode;HTMLImageElement.prototype.decode=function(){if(this.src.includes('/city/deep_water.png'))return new Promise(()=>undefined);return decode.call(this);};Object.assign(window,{restoreImageDecode:()=>{HTMLImageElement.prototype.decode=decode;}});});
 await login(page);await page.getByRole('navigation',{name:'Уровень карты'}).getByRole('button',{name:'Город',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Не удалось запустить карту',{timeout:25000});
 await page.evaluate(()=>(window as unknown as {restoreImageDecode():void}).restoreImageDecode());
 await page.getByRole('alert').getByRole('button',{name:'Повторить',exact:true}).click();await expect(page.locator('.world-canvas')).toHaveAttribute('data-city-scene-commit','atomic',{timeout:45000});
});

test('таймаут графики планеты освобождает загрузку и повторно декодирует изображения',async({page})=>{
 test.setTimeout(75000);
 await page.addInitScript(()=>{const decode=HTMLImageElement.prototype.decode;HTMLImageElement.prototype.decode=function(){if(this.src.includes('/planet/ocean.png'))return new Promise(()=>undefined);return decode.call(this);};Object.assign(window,{restoreImageDecode:()=>{HTMLImageElement.prototype.decode=decode;}});});
 await login(page);await expect(page.locator('.planet-texture-loading[role=alert]')).toContainText('графику карты',{timeout:23000});
 await page.evaluate(()=>(window as unknown as {restoreImageDecode():void}).restoreImageDecode());
 await page.locator('.planet-texture-loading').getByRole('button',{name:'Повторить',exact:true}).click();await expect(page.locator('.planet-atlas')).toHaveAttribute('data-planet-ready','true',{timeout:15000});
});
