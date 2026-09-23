import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { expect, test } from "@playwright/test";

const listen = async (server: Server) => {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
};
const close = async (server: Server) => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
};

test("display-only map images decode a CDN response without CORS headers", async ({ page }) => {
  const png = await readFile("public/game-assets/v5/atlas/terrain-v4/planet/grass.png");
  const bundle = await build({ entryPoints: ["src/client/map-image.ts"], bundle: true, write: false, format: "esm" });
  // Models the response cached by an SVG request before an Origin header was
  // sent. Such a response is valid for display, but cannot be read by canvas.
  const cdn = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "image/png", "cache-control": "max-age=3600" });
    response.end(png);
  });
  const cdnOrigin = await listen(cdn);
  const app = createServer((request, response) => {
    if (request.url === "/loader.js") {
      response.writeHead(200, { "content-type": "application/javascript" });
      response.end(bundle.outputFiles[0]!.text);
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<svg width="64" height="64"><image href="${cdnOrigin}/grass.png" width="64" height="64" /></svg>
      <p role="status">loading</p><script type="module">
      import { loadMapImage } from '/loader.js';
      loadMapImage('${cdnOrigin}/grass.png', undefined, { crossOrigin: null })
        .then(() => document.querySelector('[role=status]').textContent = 'ready')
        .catch(() => document.querySelector('[role=status]').textContent = 'error');
      </script>`);
  });
  try {
    await page.goto(await listen(app));
    await expect(page.getByRole("status")).toHaveText("ready");
  } finally {
    await page.goto("about:blank");
    await close(app); await close(cdn);
  }
});

test("planet terrain compositor uses origin sheets even with a display-only CDN", async ({ page }) => {
  const png = await readFile("public/game-assets/v5/atlas/terrain-v4/planet/grass.png");
  let cdnReads = 0, originReads = 0;
  const cdn = createServer((_request, response) => { cdnReads++; response.writeHead(200, { "content-type": "image/png" }); response.end(png); });
  const cdnOrigin = await listen(cdn);
  const bundle = await build({ entryPoints: ["src/client/planet-terrain-raster.ts"], bundle: true, write: false, format: "esm",
    define: { "import.meta.env.VITE_STATIC_ORIGIN": JSON.stringify(cdnOrigin), "import.meta.env.MODE": '"production"' } });
  const app = createServer((request, response) => {
    if (request.url === '/raster.js') { response.writeHead(200, { 'content-type': 'application/javascript' }); response.end(bundle.outputFiles[0]!.text); return; }
    if (request.url?.startsWith('/game-assets/')) { originReads++; response.writeHead(200, { 'content-type': 'image/png' }); response.end(png); return; }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<p role="status">loading</p><script type="module">
      import {rasterizePlanetTerrain} from '/raster.js';
      const cell={id:'a',q:0,r:0,terrain:'grass',x:0,y:0,width:8,height:8,size:8,center:{x:4,y:4}};
      rasterizePlanetTerrain(new Map([['land',[cell]]]),()=>15,new AbortController().signal)
        .then(result=>{const tile=result.get('land')[0];const img=new Image();img.src=tile.href;document.body.append(img);document.querySelector('[role=status]').textContent=tile.href.startsWith('data:image/png')?'ready':'error';})
        .catch(()=>document.querySelector('[role=status]').textContent='error');
    </script>`);
  });
  try {
    await page.goto(await listen(app));
    await expect(page.getByRole('status')).toHaveText('ready');
    await expect(page.locator('img')).toBeVisible();
    expect(await page.locator('img').evaluate(image => {
      const img = image as HTMLImageElement;
      const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const context = canvas.getContext('2d')!; context.drawImage(img, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      return { width: canvas.width, height: canvas.height, opaque: Array.from(pixels).filter((_,i) => i % 4 === 3).every(alpha => alpha === 255),
        colors: new Set(Array.from({length:pixels.length/4},(_,i) => `${pixels[i*4]}:${pixels[i*4+1]}:${pixels[i*4+2]}`)).size };
    })).toMatchObject({ width:16, height:16, opaque:true });
    expect(originReads).toBe(1);expect(cdnReads).toBe(0);
  } finally { await page.goto('about:blank'); await close(app); await close(cdn); }
});
