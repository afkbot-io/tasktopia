import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { BUILDING_PROFILES } from "../src/shared/building-profiles";
import { BUILDING_CATALOG } from "../src/shared/catalog";
import { compileBlockLayout } from "../src/server/world/block-layout-compiler";
import { blockSlots } from "../src/shared/block-templates";
const origin = process.env.PROFILE_PREVIEW_ORIGIN ?? "http://127.0.0.1:5196";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) throw new Error("Local preview only");
const profiles = Object.entries(BUILDING_PROFILES).map(([archetype, profile]) => {
  const layout = compileBlockLayout({ countryId: "preview", cityId: "city", seed: 123, revision: 1,
    districts: [{ id: "district", sequence: 0, archetype, tasks: Array.from({ length: 28 }, (_, i) => ({ id: `task-${i}`, taskNumber: i+1, buildingFamily: "residential", facadeVariant: "south", constructionStage: 5 as const })) }] });
  return { name: profile.label, blocks: layout.blocks.slice(0, 2).map(block => ({ width: block.width, height: block.height,
    slots: blockSlots(block).map(slot => ({ x: slot.origin.x-block.origin.x, y: slot.origin.y-block.origin.y,
      w: slot.footprintBounds.maxX-slot.footprintBounds.minX+1, h: slot.footprintBounds.maxY-slot.footprintBounds.minY+1,
      asset: BUILDING_CATALOG.find(b => b.key === slot.buildingFamily)?.stages[4] })) })) };
});
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1580, height: 720 }, deviceScaleFactor: 1 });
  await page.setContent('<html lang="ru"><style>body{background:#112927;color:#e5e2c3;font:14px Arial;margin:16px}main{display:flex;gap:12px}section{width:298px}h2{font-size:15px}canvas{display:block;margin-bottom:14px;image-rendering:pixelated;border:1px solid #647864}</style><h1>Пять профилей новых кварталов</h1><p>Одинаковые seed и 28 задач. Первые два квартала каждого профиля; здания в нативном масштабе.</p><main></main></html>');
  await page.evaluate(async ({ profiles, origin }) => {
    for (const profile of profiles) {
      const section = document.createElement("section"), title = document.createElement("h2"); title.textContent = profile.name; section.append(title);
      document.querySelector("main")!.append(section);
      for (const block of profile.blocks) {
        const canvas = document.createElement("canvas"); canvas.width = block.width*8+16; canvas.height = block.height*8+16;
        section.append(canvas); const ctx = canvas.getContext("2d")!; ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = "#759363"; ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.strokeStyle = "#5b7353";
        for (let x=8;x<canvas.width;x+=8) {ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,canvas.height);ctx.stroke();}
        for (let y=8;y<canvas.height;y+=8) {ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(canvas.width,y);ctx.stroke();}
        for (const slot of block.slots.sort((a,b)=>a.y+a.h-b.y-b.h)) {
          ctx.fillStyle = "#8a9e94";ctx.fillRect(slot.x*8,slot.y*8,(slot.w+2)*8,(slot.h+2)*8);
          if (slot.asset) {
            const image = new Image(); image.src = origin+slot.asset; await image.decode();
            ctx.drawImage(image,slot.x*8+8,slot.y*8+8+slot.h*8-image.height);
          }
        }
      }
    }
  }, { profiles, origin });
  await mkdir("screenshots/living-world", { recursive: true });
  await page.screenshot({ path: "screenshots/living-world/building-profiles.png", fullPage: true });
} finally { await browser.close(); }
