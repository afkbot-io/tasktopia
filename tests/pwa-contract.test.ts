import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { isPrivateAppPath, shouldRuntimeCache } from "../src/client/pwa-cache-policy";
import { renderServiceWorker } from "../src/client/pwa-service-worker-source";

/** Execute the generated public worker, replacing only browser platform I/O. */
function workerPlatform(source: string) {
  const origin = "https://tasktopia.online";
  type WorkerListener = (event: { request?: Request; waitUntil?: (value: Promise<unknown>) => void; respondWith?: (value: Promise<Response>) => void }) => void;
  const listeners = new Map<string, WorkerListener>();
  const entries = new Map<string, Response>();
  const requests: Request[] = [];
  let online = true;
  const network = async (input: Request | string, init?: RequestInit) => {
    const request = new Request(typeof input === "string" ? new URL(input, origin) : input, init);
    requests.push(request);
    if (!online) throw new Error("offline");
    return new Response(`public asset ${request.url}`, { status: 200 });
  };
  const key = (input: Request | string) => new URL(typeof input === "string" ? input : input.url, origin).href;
  const cache = {
    addAll: async (inputs: Array<Request | string>) => {
      for (const input of inputs) entries.set(key(input), await network(typeof input === "string" ? key(input) : input));
    },
    match: async (input: Request | string) => entries.get(key(input))?.clone(),
    put: async (input: Request | string, response: Response) => { entries.set(key(input), response.clone()); },
  };
  runInNewContext(source, {
    URL, Request, Response, fetch: network,
    caches: { open: async () => cache, keys: async () => [], delete: async () => true },
    self: { location: { origin }, addEventListener: (name: string, listener: WorkerListener) => listeners.set(name, listener) },
  });
  return {
    entries, requests,
    offline: () => { online = false; },
    install: async () => {
      let pending: Promise<unknown> | undefined;
      listeners.get("install")!({ waitUntil: value => { pending = value; } });
      await pending;
    },
    fetch: async (request: Request) => {
      let response: Promise<Response> | undefined;
      listeners.get("fetch")!({ request, respondWith: value => { response = value; } });
      return response;
    },
  };
}

describe("generated worker CDN offline boundary", () => {
  const cdn = "https://store.tasktopia.online";
  const candidates = ["/", "/site.webmanifest", "/assets/app.abc123.js", "/assets/app.abc123.css", "/assets/app.js.map", "/api/bootstrap", "/game-assets/v5/manifest.json"];

  it("serves exact CDN build scripts and styles offline without sending credentials", async () => {
    const platform = workerPlatform(renderServiceWorker("cdn-rev", candidates, cdn));
    await platform.install();
    platform.offline();
    for (const path of ["/assets/app.abc123.js", "/assets/app.abc123.css"]) {
      const response = await platform.fetch(new Request(cdn + path));
      expect(response, `offline CDN cache response for ${path}`).toBeDefined();
      expect(await response!.text()).toBe(`public asset ${cdn}${path}`);
    }
    const cdnRequests = platform.requests.filter(request => new URL(request.url).origin === cdn);
    expect(cdnRequests.map(request => request.url)).toEqual([cdn + "/assets/app.abc123.js", cdn + "/assets/app.abc123.css"]);
    expect(cdnRequests.every(request => request.credentials === "omit" && request.mode === "cors")).toBe(true);
  });

  it("never intercepts private, unknown, credentialed, authenticated or modified CDN requests", async () => {
    const platform = workerPlatform(renderServiceWorker("cdn-rev", candidates, cdn));
    await platform.install();
    const before = platform.requests.length;
    const forbidden = [
      new Request(cdn + "/api/bootstrap"), new Request(cdn + "/mcp"), new Request(cdn + "/health"),
      new Request(cdn + "/socket.io/"), new Request(cdn + "/assets/other.js"),
      new Request(cdn + "/assets/app.js.map"), new Request(cdn + "/game-assets/v5/manifest.json"),
      new Request(cdn + "/assets/app.abc123.js?private=1"),
      new Request("https://other.example/assets/app.abc123.js"),
      new Request(cdn + "/assets/app.abc123.js", { method: "POST", body: "private" }),
      new Request(cdn + "/assets/app.abc123.js", { credentials: "include" }),
      new Request(cdn + "/assets/app.abc123.js", { headers: { authorization: "Bearer local-test-only" } }),
      new Request("https://tasktopia.online/assets/app.abc123.js", { headers: { authorization: "Bearer local-test-only" } }),
    ];
    for (const request of forbidden) expect(await platform.fetch(request), request.url).toBeUndefined();
    expect(platform.requests).toHaveLength(before);
    expect(platform.requests.filter(request => new URL(request.url).origin === cdn)).toHaveLength(2);
    expect([...platform.entries.keys()].some(url => new URL(url).pathname.startsWith("/api"))).toBe(false);
  });

  it("refills only a missing allowlisted CDN asset with credential-free fetch and then serves it offline", async () => {
    const platform = workerPlatform(renderServiceWorker("cdn-rev", candidates, cdn));
    await platform.install();
    const url = cdn + "/assets/app.abc123.js";
    platform.entries.delete(url);
    expect(await (await platform.fetch(new Request(url)))!.text()).toBe(`public asset ${url}`);
    expect(platform.requests.at(-1)!.credentials).toBe("omit");
    platform.offline();
    expect(await (await platform.fetch(new Request(url)))!.text()).toBe(`public asset ${url}`);
  });

  it("keeps same-origin public shell installation unchanged when no CDN is configured", async () => {
    const platform = workerPlatform(renderServiceWorker("local-rev", candidates));
    await platform.install();
    expect(platform.requests.every(request => new URL(request.url).origin === "https://tasktopia.online")).toBe(true);
    expect(await platform.fetch(new Request(cdn + "/assets/app.abc123.js"))).toBeUndefined();
  });

  it("does not duplicate precache entries when the static origin is the app origin", async () => {
    const platform = workerPlatform(renderServiceWorker("local-rev", candidates, "https://tasktopia.online/"));
    await platform.install();
    const urls = platform.requests.map(request => request.url);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.every(url => new URL(url).origin === "https://tasktopia.online")).toBe(true);
  });

  it.each(["https://user:password@store.tasktopia.online", "https://store.tasktopia.online/path", "https://store.tasktopia.online?query=1", "https://store.tasktopia.online#fragment", "ftp://store.tasktopia.online", "//store.tasktopia.online"])(
    "rejects a non-origin CDN configuration: %s", origin => {
      expect(() => renderServiceWorker("cdn-rev", candidates, origin)).toThrow();
    },
  );

  it("does not promote traversal, source maps or protocol-relative candidates into the CDN allowlist", async () => {
    const platform = workerPlatform(renderServiceWorker("cdn-rev", [
      "/assets/app.abc123.js", "/assets/../private.js", "/assets/nested/../../api/private.js",
      "/assets/%2e%2e/private.js", "/assets/app.js.map", "//other.example/assets/app.js",
    ], cdn));
    await platform.install();
    expect(platform.requests.filter(request => new URL(request.url).origin === cdn).map(request => request.url))
      .toEqual([cdn + "/assets/app.abc123.js"]);
    expect(platform.requests.every(request => [cdn, "https://tasktopia.online"].includes(new URL(request.url).origin))).toBe(true);
    expect(platform.requests.every(request => !new URL(request.url).pathname.startsWith("/api/"))).toBe(true);
  });
});

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
    expect(worker).toContain('addEventListener("push"');
    expect(worker).toContain('addEventListener("notificationclick"');
    expect(worker).toContain('addEventListener("pushsubscriptionchange"');
    expect(worker).toContain('url.origin !== self.location.origin');
    expect(worker).toContain("showNotification");
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
