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
