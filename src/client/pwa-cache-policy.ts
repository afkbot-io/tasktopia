const PRIVATE_PREFIXES = ["/api", "/mcp", "/socket.io", "/health"] as const;

export function isPrivateAppPath(pathname: string): boolean {
  return PRIVATE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function shouldRuntimeCache(url: URL, destination: string, origin: string): boolean {
  if (url.origin !== origin || isPrivateAppPath(url.pathname)) return false;
  if (url.pathname === "/game-assets/v5/manifest.json" || url.pathname.endsWith(".map")) return false;
  if (url.pathname.startsWith("/assets/")) return ["script", "style", "font", "image"].includes(destination);
  return url.pathname.startsWith("/game-assets/v5/") && destination === "image";
}
