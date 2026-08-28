import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { renderServiceWorker } from "./src/client/pwa-service-worker-source.ts";

const devPort = Number(process.env.VITE_DEV_PORT ?? 5173);
const apiTarget = process.env.VITE_API_TARGET ?? "http://127.0.0.1:3000";
const staticOrigin = (process.env.VITE_STATIC_ORIGIN ?? "").replace(/\/$/, "");
const appVersion = (JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string }).version;

export default defineConfig({
  base: staticOrigin ? `${staticOrigin}/` : "/",
  define: { __TASKTOPIA_VERSION__: JSON.stringify(appVersion) },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "same-origin-web-manifest",
      enforce: "post",
      transformIndexHtml(html) {
        return html.replace(
          /(<link\s+rel=["']manifest["']\s+href=["'])[^"']+(["']\s*\/?>)/,
          "$1/site.webmanifest$2",
        );
      },
    },
    {
      name: "tasktopia-service-worker",
      generateBundle(_options, bundle) {
        const publicAssets = ["/", "/site.webmanifest", "/pwa-icon-192.png", "/pwa-icon-512.png", "/pwa-icon-maskable-512.png"];
        for (const fileName of Object.keys(bundle)) if (!fileName.endsWith(".map")) publicAssets.push(`/${fileName}`);
        const revisionHash = createHash("sha256").update(JSON.stringify(publicAssets.sort()));
        for (const path of publicAssets.filter((candidate) => candidate !== "/" && !candidate.startsWith("/assets/"))) {
          revisionHash.update(readFileSync(new URL(`./public${path}`, import.meta.url)));
        }
        const revision = revisionHash.digest("hex").slice(0, 12);
        this.emitFile({ type: "asset", fileName: "sw.js", source: renderServiceWorker(revision, publicAssets) });
      },
    },
  ],
  server: {
    port: devPort,
    strictPort: true,
    proxy: {
      "/api": { target: apiTarget, xfwd: true },
      "/health": { target: apiTarget, xfwd: true },
      "/socket.io": {
        target: apiTarget,
        ws: true,
        xfwd: true,
      },
      "/mcp": { target: apiTarget, xfwd: true },
    },
  },
  build: {
    outDir: "dist/public",
    sourcemap: true,
  },
});
