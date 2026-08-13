export function isStaticAssetRequest(url: string): boolean {
  const pathname = url.split("?", 1)[0] ?? url;
  return pathname === "/assets" || pathname.startsWith("/assets/")
    || pathname === "/game-assets" || pathname.startsWith("/game-assets/");
}
