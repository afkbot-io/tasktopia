export type GameAssetFallback = { alias: string; src: string };

export interface GameAssetLoader {
  load(assets: string[]): Promise<unknown>;
  add(assets: GameAssetFallback[]): void;
}

function sameOriginFallback(url: string, appOrigin: string): GameAssetFallback | undefined {
  const source = new URL(url, appOrigin);
  if (source.origin === appOrigin || !source.pathname.startsWith("/game-assets/")) return undefined;
  return {
    alias: url,
    src: `${source.pathname}${source.search}${source.hash}`,
  };
}

export async function loadGameAssets(
  loader: GameAssetLoader,
  urls: string[],
  appOrigin = window.location.origin,
): Promise<void> {
  try {
    await loader.load(urls);
  } catch (error) {
    const fallback = urls
      .map((url) => sameOriginFallback(url, appOrigin))
      .filter((asset): asset is GameAssetFallback => Boolean(asset));
    if (!fallback.length) throw error;
    loader.add(fallback);
    await loader.load(urls);
  }
}
