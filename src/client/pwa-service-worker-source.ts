import { isPrivateAppPath } from "./pwa-cache-policy.ts";

export function renderServiceWorker(revision: string, candidates: readonly string[], staticOrigin = "", installCandidates: readonly string[] = candidates): string {
  const origin = staticOrigin.replace(/\/$/, "");
  if (origin) {
    const parsed = new URL(origin);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== origin) throw new Error("Static asset origin must be an HTTP(S) origin without credentials, path, query or fragment");
  }
  const precache = [...new Set(candidates.filter(path => /^\/(?!\/)[A-Za-z0-9_./-]*$/.test(path)
    && new URL(path, "https://build.invalid").pathname === path
    && !isPrivateAppPath(path) && !path.endsWith(".map")))];
  // Only exact emitted public build files may cross the app-origin boundary.
  // Never turn the CDN origin into a general-purpose runtime cache allowlist.
  const cdnAssets = origin ? precache.filter(path =>
    /^\/assets\/[A-Za-z0-9_./-]+\.(?:js|css|woff2?|png|svg|webp|jpe?g|gif|avif)$/.test(path)
  ).map(path => origin + path) : [];
  return `const REVISION = ${JSON.stringify(revision)};
const CACHE_PREFIX = "tasktopia-shell-";
const CACHE_NAME = ${JSON.stringify(`tasktopia-shell-${revision}`)};
const PRECACHE = ${JSON.stringify(precache.filter(path => installCandidates.includes(path) && !(origin && path.startsWith("/assets/"))))};
const CDN_PRECACHE = ${JSON.stringify(cdnAssets.filter(url => installCandidates.includes(url.slice(origin.length))))};
const CDN_ASSETS = new Set(${JSON.stringify(cdnAssets)});
const PRIVATE_PREFIXES = ["/api", "/mcp", "/socket.io", "/health"];
const isPrivatePath = (path) => PRIVATE_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix + "/"));
const isRuntimeAsset = (request, url) => url.origin === self.location.origin && !isPrivatePath(url.pathname)
  && !url.pathname.endsWith(".map") && url.pathname !== "/game-assets/v5/manifest.json"
  && ((url.pathname.startsWith("/assets/") && ["script", "style", "font", "image"].includes(request.destination))
    || (url.pathname.startsWith("/game-assets/v5/") && request.destination === "image"));
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll([
  ...PRECACHE, ...CDN_PRECACHE.map((url) => new Request(url, { mode: "cors", credentials: "omit" })),
]))));
self.addEventListener("message", (event) => {
  if (event.data?.type === "TASKTOPIA_SKIP_WAITING") event.waitUntil(self.skipWaiting());
});
self.addEventListener("activate", (event) => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || isPrivatePath(url.pathname) || event.request.headers.has("authorization")) return;
  const isCdnAsset = url.origin !== self.location.origin && CDN_ASSETS.has(url.href)
    && event.request.credentials !== "include";
  if (url.origin !== self.location.origin && !isCdnAsset) return;
  if (!isCdnAsset && event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(async () => (await (await caches.open(CACHE_NAME)).match("/")) || Response.error()));
    return;
  }
  if (!isCdnAsset && !isRuntimeAsset(event.request, url)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached) return cached;
    const response = await fetch(event.request, isCdnAsset ? { credentials: "omit" } : undefined);
    if (response.ok) await cache.put(event.request, response.clone());
    return response;
  })());
});
self.addEventListener("push", (event) => event.waitUntil((async () => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const title = typeof payload.title === "string" ? payload.title.slice(0, 160) : "Tasktopia";
  const body = typeof payload.body === "string" ? payload.body.slice(0, 240) : "В стране есть обновление";
  let url = new URL("/", self.location.origin);
  try {
    const candidate = new URL(typeof payload.url === "string" ? payload.url : "/", self.location.origin);
    if (candidate.origin === self.location.origin) url = candidate;
  } catch { /* Keep the safe root target. */ }
  await self.registration.showNotification(title, {
    body, tag: typeof payload.tag === "string" ? payload.tag.slice(0, 64) : undefined,
    icon: "/pwa-icon-192.png", badge: "/pwa-icon-192.png", data: { url: url.href },
  });
})()));
self.addEventListener("notificationclick", (event) => event.waitUntil((async () => {
  event.notification.close();
  let url = new URL("/", self.location.origin);
  try {
    const candidate = new URL(event.notification.data?.url || "/", self.location.origin);
    if (candidate.origin !== self.location.origin) return;
    url = candidate;
  } catch { return; }
  for (const client of await self.clients.matchAll({ type: "window", includeUncontrolled: true })) {
    if (new URL(client.url).origin !== self.location.origin) continue;
    await client.navigate(url.href);
    return client.focus();
  }
  return self.clients.openWindow(url.href);
})()));
self.addEventListener("pushsubscriptionchange", (event) => event.waitUntil((async () => {
  try {
    const subscription = event.newSubscription || await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: event.oldSubscription?.options?.applicationServerKey,
    });
    await fetch("/api/push/subscriptions", {
      method: "POST", credentials: "include", headers: { "content-type": "application/json" },
      body: JSON.stringify(subscription.toJSON()),
    });
  } catch { /* The next foreground readiness check repairs the subscription. */ }
})()));
`;
}
