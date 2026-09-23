import { expect, test } from '@playwright/test';

test.beforeEach(async({page})=>{
 await page.request.post('/api/auth/login',{data:{email:'demo@tasktopia.local',password:'tasktopia-demo'}});
 await page.goto('/');
 await expect(page.locator('.planet-atlas')).toHaveAttribute('data-planet-ready','true');
});

test('планета не предлагает городской слой и фильтры',async({page})=>{
 await expect(page.getByRole('navigation',{name:'Уровень карты'})).toHaveCount(0);
 await expect(page.getByLabel('Фильтры',{exact:true})).toHaveCount(0);
 await expect(page.locator('.map-toolbar').getByLabel('Уведомления',{exact:true})).toBeVisible();
});

test('верхние панели закрывают предыдущую при мыши и клавиатуре',async({page})=>{
 await page.locator('.map-toolbar-actions > nav > .world-preferences > summary').click();
 await expect(page.locator('.world-preferences[open]')).toHaveCount(1);
 await page.locator('.map-toolbar-actions > nav > .map-legend:not(.world-preferences) > summary').focus();
 await page.keyboard.press('Enter');
 await expect(page.locator('.map-toolbar details[open]')).toHaveCount(1);
 await expect(page.locator('.world-preferences[open]')).toHaveCount(0);
 await page.getByLabel('Меню',{exact:true}).click();
 await expect(page.locator('.map-toolbar details[open]')).toHaveCount(1);
 await page.getByRole('button',{name:'Города',exact:true}).click();
 await expect(page.locator('.city-directory')).toBeVisible();
 await page.locator('.map-toolbar-actions > nav > .world-preferences > summary').click();
 await expect(page.locator('.city-directory')).toHaveCount(0);
 await page.keyboard.press('Escape');
 await expect(page.locator('.map-toolbar details[open]')).toHaveCount(0);
});

for(const width of [1440,390])test(`городская панель без пустой колонки ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await page.locator('.planet-city-targets [data-city-id]').first().focus();await page.keyboard.press('Enter');
 await expect(page.locator('.world-canvas')).toHaveAttribute('data-city-scene-commit','atomic',{timeout:45000});
 await expect(page.locator('.map-level-transition')).toHaveCount(0,{timeout:15000});
 const nav=page.getByRole('navigation',{name:'Уровень карты'});
 await expect(nav.getByRole('button')).toHaveCount(3);
 const geometry=await nav.evaluate(node=>{const r=node.getBoundingClientRect();const buttons=[...node.querySelectorAll('button')].map(x=>x.getBoundingClientRect());return {width:r.width,content:buttons.at(-1)!.right-buttons[0]!.left,right:r.right-buttons.at(-1)!.right,left:buttons[0]!.left-r.left};});
 expect(geometry.right).toBeLessThanOrEqual(6);expect(geometry.left).toBeLessThanOrEqual(6);
 expect(geometry.width-geometry.content).toBeLessThanOrEqual(12);
 await expect(page.getByLabel('Фильтры',{exact:true})).toBeVisible();
 await nav.getByRole('button',{name:'Планета',exact:true}).click();
 await expect(page.locator('.planet-atlas')).toBeVisible();
 await expect(nav).toHaveCount(0);await expect(page.getByLabel('Фильтры',{exact:true})).toHaveCount(0);
});

test('подписи меняются от стран к городам, материал не перестраивается при зуме',async({page})=>{
 const planet=page.locator('.planet-atlas');
 await expect(planet).toHaveAttribute('data-label-detail','NONE');
 await expect(page.locator('.planet-city-label,.planet-country-label')).toHaveCount(0);
 await expect(page.locator('[data-terrain-raster]').first()).toBeVisible();
 const land=await page.locator('.planet-country-terrain').first().elementHandle();
 const source=await land!.evaluate(node=>node.innerHTML);
 await planet.locator(':scope > svg').dispatchEvent('wheel',{deltaY:-300,clientX:720,clientY:420,bubbles:true});
 await expect(planet).toHaveAttribute('data-label-detail','COUNTRIES');
 await expect(page.locator('.planet-country-label').first()).toBeVisible();
 await expect(page.locator('.planet-city-label')).toHaveCount(0);
 await page.locator('.planet-city-targets [data-city-id]').first().click();
 await expect(planet).toHaveAttribute('data-globe-zoom','3.00');
 await expect(page.locator('.planet-city-label').first()).toBeVisible();
 await expect(page.locator('.planet-country-label')).toHaveCount(0);
 expect(await land!.evaluate(node=>node.innerHTML)).toBe(source);
 await page.setViewportSize({width:390,height:844});
 const label=page.locator('.planet-city-label text').first();
 await expect.poll(()=>label.evaluate(node=>node.getBoundingClientRect().height)).toBeGreaterThan(10);
});

test('маска планеты покрывает высокий экран без прямого обрезания',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.locator('.planet-city-targets [data-city-id]').first().click();
 await expect(page.locator('.planet-atlas')).toHaveAttribute('data-globe-zoom','3.00');
 const bounds=await page.locator('.planet-atlas > svg').evaluate(svg=>{
   const box=svg.getBoundingClientRect(),fit=Math.min(box.width/1000,box.height/700);
   const viewMin=(700-box.height/fit)/2,viewMax=700-viewMin;
   const edge=svg.querySelector<SVGEllipseElement>('.planet-atmosphere')!.getBBox();
   const rows=[...svg.querySelectorAll('clipPath rect')].map(row=>({y:Number(row.getAttribute('y')),height:Number(row.getAttribute('height'))}));
   return {expectedTop:Math.max(viewMin,edge.y),expectedBottom:Math.min(viewMax,edge.y+edge.height),top:Math.min(...rows.map(r=>r.y)),bottom:Math.max(...rows.map(r=>r.y+r.height))};
 });
 expect(bounds.top-bounds.expectedTop).toBeLessThanOrEqual(16);
 expect(bounds.expectedBottom-bounds.bottom).toBeLessThanOrEqual(16);
});
