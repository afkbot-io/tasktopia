import type { PlanetMapCell } from '../shared/planet-atlas';
import { overviewTerrainPatches } from '../shared/overview-terrain-presentation';
import { gameAssetUrl } from '../shared/catalog';
import { loadMapImage } from './map-image';

export type PlanetTerrainRaster = { id: string; x: number; y: number; width: number; height: number; href: string };

/** Cache authored 2×2 material patches at their native resolution. Chunking
 * bounds canvas allocations even when a coast spans the whole planet. No new
 * terrain or colors are generated, and zoom never reruns this compositor. */
export async function rasterizePlanetTerrain(layers: Map<string, PlanetMapCell[]>, mask: (cell: PlanetMapCell) => number, signal: AbortSignal) {
  const patches = new Map<PlanetMapCell, ReturnType<typeof overviewTerrainPatches>>();
  const urls = new Set<string>();
  for (const cells of layers.values()) for (const cell of cells) {
    const material = overviewTerrainPatches(cell.terrain, 'planet', cell.q, cell.r, mask(cell));
    patches.set(cell, material);
    for (const patch of material) urls.add(patch.tile.url);
  }
  // The same immutable sheets are served by the app origin as well as CDN.
  // Use the origin for canvas input: an older display-only CDN cache entry
  // may lack CORS headers and must not taint or block this compositor.
  const images = new Map(await Promise.all([...urls].map(async url => {
    const path = new URL(gameAssetUrl(url), window.location.href).pathname;
    return [url, await loadMapImage(path, signal)] as const;
  })));
  const result = new Map<string, PlanetTerrainRaster[]>();
  for (const [id, cells] of layers) {
    signal.throwIfAborted();
    const chunks = new Map<string, PlanetMapCell[]>();
    for (const cell of cells) {
      const key = `${Math.floor(cell.q / 16)}:${Math.floor(cell.r / 16)}`;
      const chunk = chunks.get(key) ?? [];
      chunk.push(cell); chunks.set(key, chunk);
    }
    const rasters: PlanetTerrainRaster[] = [];
    for (const [key, chunk] of chunks) {
      signal.throwIfAborted();
      const x = Math.min(...chunk.map(cell => cell.x)), y = Math.min(...chunk.map(cell => cell.y));
      const width = Math.max(...chunk.map(cell => cell.x + cell.width)) - x;
      const height = Math.max(...chunk.map(cell => cell.y + cell.height)) - y;
      const first = chunk[0]!, tileSize = patches.get(first)![0]!.tile.tileSize;
      const density = tileSize * 2 / first.width;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * density); canvas.height = Math.round(height * density);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Не удалось подготовить ландшафт планеты');
      context.imageSmoothingEnabled = false;
      for (const cell of chunk) for (const patch of patches.get(cell)!) {
        const { tile } = patch;
        context.drawImage(images.get(tile.url)!, tile.sourceX, tile.sourceY, tile.tileSize, tile.tileSize,
          (cell.x - x + patch.x * cell.width) * density, (cell.y - y + patch.y * cell.height) * density,
          patch.size * cell.width * density, patch.size * cell.height * density);
      }
      const href = canvas.toDataURL('image/png');
      await loadMapImage(href, signal, { crossOrigin: null });
      rasters.push({ id: key, x, y, width, height, href });
      canvas.width = canvas.height = 0;
    }
    result.set(id, rasters);
  }
  return result;
}
