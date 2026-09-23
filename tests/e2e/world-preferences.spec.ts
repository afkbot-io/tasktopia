import { openMapCity } from "./map-navigation";
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const world=(page:Page)=>page.locator('.world-canvas');
const preferences=(page:Page)=>page.locator('.world-preferences:visible');
async function login(page:Page){await page.request.post('/api/auth/login',{data:{email:'demo@tasktopia.local',password:'tasktopia-demo'}});await page.goto('/');await expect(page.locator('.planet-atlas')).toHaveAttribute('data-planet-ready','true',{timeout:45000});}
async function city(page:Page){await openMapCity(page);await expect(world(page)).toHaveAttribute('data-loading','false',{timeout:45000});}

test('детализация и уменьшение движения сохраняют сцену и не возвращают старое ночное освещение',async({page},info)=>{
 await page.addInitScript(()=>localStorage.setItem('tasktopia:world-preferences:v1',JSON.stringify({quality:'NORMAL',lighting:'NIGHT'})));
 await login(page);await city(page);const host=world(page),canvas=await host.locator('canvas').elementHandle();
 const bakes=await host.getAttribute('data-ground-rebuilds');await expect(host).toHaveAttribute('data-light-phase','DAY');
 await preferences(page).locator('> summary').click();await expect(page.getByLabel('Освещение',{exact:true})).toHaveCount(0);
 await preferences(page).getByLabel('Детализация').selectOption('ECONOMY');
 await expect(host).toHaveAttribute('data-frame-limit','30');await expect.poll(async()=>Number(await host.getAttribute('data-construction-workers'))).toBeLessThanOrEqual(2);
 expect(await host.getAttribute('data-ground-rebuilds')).toBe(bakes);expect(await canvas!.evaluate(el=>el.isConnected)).toBe(true);
 await preferences(page).getByLabel('Детализация').selectOption('NORMAL');await expect(host).toHaveAttribute('data-frame-limit','60');
 await expect.poll(async()=>Number(await host.getAttribute('data-construction-workers'))).toBeGreaterThan(2);
 await page.emulateMedia({reducedMotion:'reduce'});await expect(host).toHaveAttribute('data-animation-active','false');await expect(host).toHaveAttribute('data-construction-workers','0');
 await page.clock.setFixedTime(new Date('2026-09-16T21:00:00Z'));await expect(host).toHaveAttribute('data-light-phase','DAY');
 expect(await host.getAttribute('data-ground-rebuilds')).toBe(bakes);
 await page.emulateMedia({reducedMotion:'no-preference'});await expect(host).toHaveAttribute('data-animation-active','true');
 await page.screenshot({path:info.outputPath('full-detail.png')});
 await page.reload();await city(page);await preferences(page).locator('> summary').click();
 await expect(preferences(page).getByLabel('Детализация')).toHaveValue('NORMAL');
});

test('мобильные настройки работают при недоступном localStorage и помещаются на экран',async({page},info)=>{
 await page.setViewportSize({width:390,height:700});
 await page.addInitScript(()=>{
  // Exercise the offer/menu overlap even on hosts without native Web Push.
  Object.defineProperty(window,'PushManager',{configurable:true,value:class {}});
  Object.defineProperty(window,'Notification',{configurable:true,value:{permission:'default'}});
  const get=Storage.prototype.getItem,set=Storage.prototype.setItem;
  Storage.prototype.getItem=function(k){if(k.startsWith('tasktopia:world-preferences:'))throw new DOMException('Blocked','SecurityError');return get.call(this,k);};
  Storage.prototype.setItem=function(k,v){if(k.startsWith('tasktopia:world-preferences:'))throw new DOMException('Blocked','SecurityError');set.call(this,k,v);};
 });
 await login(page);await expect(page.locator('.push-card-compact')).toBeVisible();
 await page.locator('.world-menu > summary').click();await preferences(page).locator('> summary').click();
 await preferences(page).getByLabel('Детализация').selectOption('ECONOMY');await expect(page.locator('html')).toHaveAttribute('data-world-quality','ECONOMY');
 const box=(await preferences(page).locator('.map-legend-panel').boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);
 const menu=(await page.locator('.world-menu > .game-popover-panel').boundingBox())!;
 expect(menu.y+menu.height).toBeLessThanOrEqual(700);
 await preferences(page).getByLabel('Уменьшить движение').check();await expect(page.locator('html')).toHaveAttribute('data-world-motion','REDUCED');
 const accessibility=await new AxeBuilder({page}).include('.world-menu').analyze();
 expect(accessibility.violations.filter(v=>v.impact==='serious'||v.impact==='critical').map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}))).toEqual([]);
 await page.screenshot({path:info.outputPath('mobile-preferences.png')});
 await page.locator('.world-menu > summary').click();await city(page);await expect(world(page)).toHaveAttribute('data-animation-active','false');
 await expect(world(page)).toHaveAttribute('data-frame-limit','30');
});

test('AUTO облегчает планету при устойчивой нагрузке, сохраняя географию и подписи',async({page})=>{
 await page.addInitScript(()=>{
  const original=requestAnimationFrame.bind(window);let previous=-1,synthetic=0;
  Object.assign(window,{qualityTestPressure:false});
  window.requestAnimationFrame=callback=>original(time=>{
   if(time!==previous){synthetic=(window as unknown as {qualityTestPressure:boolean}).qualityTestPressure?synthetic+100:time;previous=time;}
   callback(synthetic);
  });
 });
 await login(page);const planet=page.locator('.planet-atlas'),cities=await planet.locator('.planet-city-targets [data-city-id]').count(),images=await planet.locator('image').count();
 await preferences(page).locator('> summary').click();await preferences(page).getByLabel('Детализация').selectOption('AUTO');
 await page.evaluate(()=>Object.assign(window,{qualityTestPressure:true}));await expect(page.locator('html')).toHaveAttribute('data-world-quality','ECONOMY',{timeout:15000});
 expect(await planet.locator('image').count()).toBe(images);expect(await planet.locator('.planet-city-targets [data-city-id]').count()).toBe(cities);
 await preferences(page).getByLabel('Детализация').selectOption('NORMAL');await expect(page.locator('html')).toHaveAttribute('data-world-quality','NORMAL');
 await page.emulateMedia({reducedMotion:'reduce'});await expect.poll(()=>planet.locator('svg').first().evaluate(el=>(el as SVGSVGElement).animationsPaused())).toBe(true);
});
