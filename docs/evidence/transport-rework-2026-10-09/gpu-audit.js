// Read-only graphics allocation audit for the isolated local transport fixture.
// These are requested WebGL bytes, not driver/process GPU memory.
/* global window, document, process, console, URL */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {chromium} from '@playwright/test';
const base=process.env.E2E_BASE_URL??'http://127.0.0.1:5228';
assert.match(new URL(base).hostname,/^(127\.0\.0\.1|localhost)$/);
const fixture=JSON.parse(readFileSync('.builder/transport-rework-2026-10-09/functional-fixture.json','utf8'));
assert.match(fixture.schema,/^transport_qa_[a-f0-9]{32}$/);
const browser=await chromium.launch({args:['--enable-gpu','--use-angle=metal']});
try{
 const page=await browser.newPage({baseURL:base,viewport:{width:1440,height:1000},deviceScaleFactor:1});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  const states=[],byContext=new WeakMap();
  const state=gl=>{let s=byContext.get(gl);if(!s){s={textures:new Map(),buffers:new Map(),bindings:new Map(),ids:new WeakMap(),nextId:1,unit:0};byContext.set(gl,s);states.push(s);}return s;};
  const id=(s,value)=>{if(!value)return 0;let key=s.ids.get(value);if(!key){key=s.nextId++;s.ids.set(value,key);}return key;};
  const bytesPerPixel=(gl,format,type)=>{
   const channels=format===gl.RGB?3:format===gl.RED||format===gl.ALPHA||format===gl.LUMINANCE?1:format===gl.RG||format===gl.LUMINANCE_ALPHA?2:4;
   return channels*(type===gl.FLOAT?4:type===gl.HALF_FLOAT?2:1);
  };
  for(const Ctor of [window.WebGLRenderingContext,window.WebGL2RenderingContext].filter(Boolean)){
   const p=Ctor.prototype;
   const wrap=(name,record)=>{const original=p[name];if(typeof original!=='function')return;p[name]=function(...args){const value=original.apply(this,args);record(this,args);return value;};};
   wrap('activeTexture',(gl,a)=>state(gl).unit=a[0]);
   wrap('bindTexture',(gl,a)=>{const s=state(gl);s.bindings.set(`texture:${s.unit}:${a[0]}`,a[1]);});
   wrap('texImage2D',(gl,a)=>{
    if(a[1]!==0)return;const s=state(gl),key=id(s,s.bindings.get(`texture:${s.unit}:${a[0]}`));if(!key)return;
    const source=a[5],width=a.length===6?(source?.naturalWidth??source?.videoWidth??source?.width):a[3],height=a.length===6?(source?.naturalHeight??source?.videoHeight??source?.height):a[4];
    const format=a.length===6?a[3]:a[6],type=a.length===6?a[4]:a[7];
    if(Number.isFinite(width)&&Number.isFinite(height))s.textures.set(key,width*height*bytesPerPixel(gl,format,type));
   });
   wrap('texStorage2D',(gl,a)=>{const s=state(gl),key=id(s,s.bindings.get(`texture:${s.unit}:${a[0]}`));if(!key)return;let bytes=0;for(let level=0;level<a[1];level++)bytes+=Math.max(1,a[3]>>level)*Math.max(1,a[4]>>level)*4;s.textures.set(key,bytes);});
   wrap('deleteTexture',(gl,a)=>{const s=state(gl);s.textures.delete(id(s,a[0]));});
   wrap('bindBuffer',(gl,a)=>state(gl).bindings.set(`buffer:${a[0]}`,a[1]));
   wrap('bufferData',(gl,a)=>{const s=state(gl),key=id(s,s.bindings.get(`buffer:${a[0]}`));if(key)s.buffers.set(key,typeof a[1]==='number'?a[1]:a[1]?.byteLength??0);});
   wrap('deleteBuffer',(gl,a)=>{const s=state(gl);s.buffers.delete(id(s,a[0]));});
  }
  window.__transportGraphicsSnapshot=()=>({contexts:states.length,textures:states.reduce((n,s)=>n+s.textures.size,0),textureBytes:states.reduce((n,s)=>n+[...s.textures.values()].reduce((a,b)=>a+b,0),0),buffers:states.reduce((n,s)=>n+s.buffers.size,0),bufferBytes:states.reduce((n,s)=>n+[...s.buffers.values()].reduce((a,b)=>a+b,0),0),canvasBackingBytesEstimate:[...document.querySelectorAll('canvas')].reduce((n,c)=>n+c.width*c.height*4,0)});
 });
 assert.equal((await page.request.post('/api/auth/login',{data:{email:'transport-qa@example.test',password:'tasktopia-transport-qa'}})).status(),200);
 assert.equal((await page.request.post(`/api/countries/${fixture.sites[0].countryId}/select`)).status(),200);
 await page.goto('/');const host=page.locator('.world-canvas');
 const enter=async()=>{await page.locator('.planet-atlas[data-planet-ready="true"]').waitFor();await page.locator(`.planet-city-targets [data-city-id="${fixture.sites[0].city.id}"]`).focus();await page.keyboard.press('Enter');await host.locator('canvas').waitFor();await page.waitForFunction(()=>{const data=document.querySelector('.world-canvas')?.dataset;return data?.citySceneCommit==='atomic'&&data.mapActive==='true';});};
 await enter();await page.waitForTimeout(8000);
 const snapshot=()=>page.evaluate(()=>window.__transportGraphicsSnapshot());
 const start=await snapshot();
 for(let i=0;i<20;i++){
  await page.getByRole('button',{name:'Планета',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.world-canvas')?.dataset.mapActive==='false');await enter();
 }
 await page.waitForTimeout(3000);const after=await snapshot();
 assert.equal(after.contexts,start.contexts,'Navigation must reuse the existing WebGL context');
 assert.ok(after.textureBytes-start.textureBytes<5*1024*1024,'Bounded requested texture storage');
 assert.ok(after.bufferBytes-start.bufferBytes<5*1024*1024,'Bounded requested buffer storage');
 assert.deepEqual(errors,[]);
 const result={kind:'requested WebGL allocations',scope:'RGBA texture/buffer calls and single canvas backing estimate; excludes driver overhead, compressed/multisample/renderbuffer allocations and non-WebGL decoder memory',viewport:{width:1440,height:1000},dpr:1,browser:browser.version(),cycles:20,start,after,errors};
 writeFileSync('docs/evidence/transport-rework-2026-10-09/gpu-report.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await browser.close();}
