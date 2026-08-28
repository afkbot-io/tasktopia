import { isPrivateAppPath } from "./pwa-cache-policy.ts";

export function renderServiceWorker(revision: string, candidates: readonly string[]): string {
  const precache = [...new Set(candidates.filter((path) => path.startsWith("/") && !isPrivateAppPath(path) && !path.endsWith(".map")))];
  return `const REVISION = ${JSON.stringify(revision)};
const CACHE_PREFIX = "tasktopia-shell-";
const CACHE_NAME = ${JSON.stringify(`tasktopia-shell-${revision}`)};
const PRECACHE = ${JSON.stringify(precache)};
const PRIVATE_PREFIXES = ["/api", "/mcp", "/socket.io", "/health"];
const isPrivatePath = (path) => PRIVATE_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix + "/"));
const isRuntimeAsset = (request, url) => url.origin === self.location.origin && !isPrivatePath(url.pathname)
  && !url.pathname.endsWith(".map") && url.pathname !== "/game-assets/v5/manifest.json"
  && ((url.pathname.startsWith("/assets/") && ["script", "style", "font", "image"].includes(request.destination))
    || (url.pathname.startsWith("/game-assets/v5/") && request.destination === "image"));
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))));
self.addEventListener("activate", (event) => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || isPrivatePath(url.pathname)) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(async () => (await (await caches.open(CACHE_NAME)).match("/")) || Response.error()));
    return;
  }
  if (!isRuntimeAsset(event.request, url)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.ok) await cache.put(event.request, response.clone());
    return response;
  })());
});
`;
}
