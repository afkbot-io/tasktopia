/* global process, console, document, performance, requestAnimationFrame, KeyboardEvent, getComputedStyle */
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const base=process.env.BENCH_URL??'http://127.0.0.1:5196';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:2});
const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
await page.request.post(base+'/api/auth/login',{data:{email:'demo@tasktopia.local',password:'tasktopia-demo'}});
const atlas=await (await page.request.get(base+'/api/planet-atlas')).json();
if(process.env.LARGE){
 const country=atlas.countries[0];
 atlas.geography=undefined;atlas.seaRoutes=[];atlas.revision='benchmark-six-countries';
 atlas.countries=Array.from({length:6},(_,i)=>({...country,id:`bench-${i}`,name:`Страна ${i}`,seed:country.seed+i*731,
  districtCount:40,buildingCount:400,cities:country.cities.map(city=>({...city,id:`${i}-${city.id}`,
   miniature:city.miniature?.map(p=>({...p,id:`${i}-${p.id}`})),airports:[],stations:[],ports:[]}))}));
 await page.route('**/api/planet-atlas',route=>route.fulfill({json:atlas}));
}
const results=[];
for(let run=0;run<3;run++){
 await page.goto(base);await page.locator('.planet-atlas[data-planet-ready="true"]').waitFor({timeout:60000});
 await page.locator('.planet-city-targets [data-city-id]').first().click();
 await page.waitForFunction(()=>document.querySelector('.planet-atlas')?.getAttribute('data-globe-zoom')==='3.00');
 if(process.env.NO_FILTER)await page.addStyleTag({content:'.planet-country-terrain {filter:none!important;}'});
 await page.locator('.planet-atlas > svg').dispatchEvent('wheel',{deltaY:-400,clientX:720,clientY:420,bubbles:true});
 await page.waitForFunction(()=>Number(document.querySelector('.planet-atlas')?.getAttribute('data-globe-zoom'))>5.45);
 const land=await page.locator('.planet-country-terrain').first().boundingBox();
 await page.mouse.move(Math.max(30,Math.min(1400,land.x+land.width*.5)),Math.max(80,Math.min(850,land.y+land.height*.5)));
 const sample=await page.evaluate(async()=>{
  const samples=[];let last=performance.now();const start=last;
  while(performance.now()-start<2500){if(samples.length%10===0)document.querySelector('.planet-atlas > svg').dispatchEvent(new KeyboardEvent('keydown',{key:samples.length%20===0?'ArrowRight':'ArrowLeft',bubbles:true}));
  await new Promise(requestAnimationFrame);const now=performance.now();samples.push(now-last);last=now;}
  samples.sort((a,b)=>a-b);return {frames:samples.length,p50:samples[Math.floor(samples.length*.5)],p95:samples[Math.floor(samples.length*.95)],max:samples.at(-1),nodes:document.querySelectorAll('.planet-atlas *').length,filter:getComputedStyle(document.querySelector('.planet-country-terrain')).filter};
 });results.push(sample);
}
await page.screenshot({path:'.builder/evidence/benchmark-map.png'});
await writeFile(process.env.BENCH_OUT??'.builder/evidence/planet-baseline.json',JSON.stringify({base,results},null,2));console.log(results);await browser.close();
