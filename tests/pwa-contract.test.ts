import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isPrivateAppPath, shouldRuntimeCache } from "../src/client/pwa-cache-policy";
import { renderServiceWorker } from "../src/client/pwa-service-worker-source";

describe("PWA public/private cache boundary", () => {
  it.each(["/api/bootstrap", "/api/countries/x/cities/y/scene", "/mcp", "/socket.io/", "/health"])(
    "never caches %s",
    (path) => expect(isPrivateAppPath(path)).toBe(true),
  );

  it("runtime-caches only same-origin immutable public assets", () => {
    expect(shouldRuntimeCache(new URL("https://tasktopia.online/assets/app.abc123.js"), "script", "https://tasktopia.online")).toBe(true);
    expect(shouldRuntimeCache(new URL("https://tasktopia.online/game-assets/v5/manifest.json"), "", "https://tasktopia.online")).toBe(false);
    expect(shouldRuntimeCache(new URL("https://cdn.example/app.abc123.js"), "script", "https://tasktopia.online")).toBe(false);
    expect(shouldRuntimeCache(new URL("https://tasktopia.online/api/bootstrap"), "", "https://tasktopia.online")).toBe(false);
  });

  it("generates a revisioned worker with offline navigation and no private precache", () => {
    const worker = renderServiceWorker("rev-123", ["/", "/assets/app.abc123.js", "/api/bootstrap"]);
    expect(worker).toContain("tasktopia-shell-rev-123");
    expect(worker).toContain("event.request.mode === \"navigate\"");
    expect(worker).not.toContain('"/api/bootstrap"');
    expect(worker).not.toContain("notificationclick");
  });
});

describe("PWA manifest", () => {
  const manifest = JSON.parse(readFileSync(new URL("../public/site.webmanifest", import.meta.url), "utf8"));
  it("has a stable same-origin identity and install icons", () => {
    expect(manifest).toMatchObject({ id: "/", start_url: "/", scope: "/", display: "standalone" });
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ sizes: "192x192", type: "image/png" }),
      expect.objectContaining({ sizes: "512x512", type: "image/png" }),
      expect.objectContaining({ sizes: "512x512", purpose: expect.stringContaining("maskable") }),
    ]));
  });

  it("ships an opaque 512px maskable icon", () => {
    const icon = readFileSync(new URL("../public/pwa-icon-maskable-512.png", import.meta.url));
    expect(icon.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(icon.readUInt32BE(16)).toBe(512);
    expect(icon.readUInt32BE(20)).toBe(512);
    expect(icon[25]).toBe(2);
  });
});
