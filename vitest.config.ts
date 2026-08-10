import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["tests/e2e/**", "node_modules/**", "dist/**"],
    // Every integration file creates and migrates its own PostgreSQL schema.
    // Running world generators concurrently only contends for the same local
    // database/CPU and makes otherwise bounded fixtures time out.
    fileParallelism: false,
  },
});
