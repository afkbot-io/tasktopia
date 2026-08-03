import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const devPort = Number(process.env.VITE_DEV_PORT ?? 5173);
const apiTarget = process.env.VITE_API_TARGET ?? "http://127.0.0.1:3000";

export default defineConfig({
  plugins: [react()],
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
