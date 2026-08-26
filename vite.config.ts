import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

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
