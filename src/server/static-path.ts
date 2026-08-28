export function isStaticAssetRequest(url: string): boolean {
  const pathname = url.split("?", 1)[0] ?? url;
  return pathname === "/sw.js" || pathname === "/site.webmanifest"
    || pathname === "/pwa-icon-192.png" || pathname === "/pwa-icon-512.png" || pathname === "/pwa-icon-maskable-512.png"
    || pathname === "/assets" || pathname.startsWith("/assets/")
    || pathname === "/game-assets" || pathname.startsWith("/game-assets/");
}
