import { COUNTRY_TERRAIN_KINDS, type CountryOverviewDto } from "../shared/country-overview-contract";
import { roadAtlasSurfaceTile, roadAtlasTile } from "../shared/road-atlas";

export const COUNTRY_ROAD_ASPHALT_PIXELS = 3;
export const COUNTRY_ROAD_PAVEMENT_PIXELS = 5;
export const COUNTRY_ROAD_ATLAS_TILES = {
  asphalt: roadAtlasTile({ x: 0, y: 0, mask: 15, structure: "ROAD", roadClass: "LOCAL" }),
  pavement: roadAtlasSurfaceTile("PAVEMENT", 0, 0, 15),
} as const;
export type CountryRoadRasterRect = { x: number; y: number; width: number; height: number };
export type CountryRoadRasterPlan = {
  routes: Array<{ id: string; clipRects: CountryRoadRasterRect[]; asphaltRects: CountryRoadRasterRect[]; pavementRects: CountryRoadRasterRect[] }>;
  rejectedRouteIds: string[]; corridorCellCount: number; rectCount: number;
};
export type CountryRoadRasterContext = Pick<CanvasRenderingContext2D,
  "save" | "restore" | "beginPath" | "rect" | "clip" | "fillRect" | "fillStyle" | "imageSmoothingEnabled">;

/** Integer raster rectangles, never antialiased strokes or unverified map links. */
export function planCountryRoadRaster(roads: CountryOverviewDto["groundRoads"], geography: CountryOverviewDto["geography"], rasterScale = 4): CountryRoadRasterPlan {
  const { columns, rows, cellSize } = geography;
  if (geography.topology !== "SQUARE_4" || ![columns, rows, cellSize, rasterScale].every(value => Number.isSafeInteger(value) && value > 0)
    || columns * rows > 4096 || roads.routes.length > 100
    || roads.routes.reduce((sum, route) => sum + route.points.length, 0) > 50_000
    || roads.routes.reduce((sum, route) => sum + route.corridorCells.length, 0) > 50_000) throw new Error("Country road raster exceeds geometry bounds");
  const result: CountryRoadRasterPlan = { routes: [], rejectedRouteIds: [], corridorCellCount: 0, rectCount: 0 };
  const allCells = new Set<number>();
  const dry = (index: number) => {
    if (!Number.isSafeInteger(index) || index < 0 || index >= columns * rows) return false;
    const code = geography.terrainCodes[index];
    // Unlike the generic display decoder, malformed/missing codes must not become grass.
    const kind = code && /^[0-9a]$/i.test(code) ? COUNTRY_TERRAIN_KINDS[Number.parseInt(code, 16)] : undefined;
    return kind !== undefined && !["river", "deep_water", "shallow_water", "unknown"].includes(kind);
  };
  for (const route of [...roads.routes].sort((a, b) => a.id.localeCompare(b.id))) {
    const corridor = new Set(route.corridorCells);
    let valid = route.points.length >= 2 && corridor.size > 0 && [...corridor].every(dry)
      && route.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)
        && point.x >= 0 && point.x < columns * cellSize && point.y >= 0 && point.y < rows * cellSize);
    for (let at = 1; valid && at < route.points.length; at++) {
      const a = route.points[at - 1]!, b = route.points[at]!;
      if (a.x !== b.x && a.y !== b.y) { valid = false; break; }
      const minColumn = Math.floor(Math.min(a.x, b.x) / cellSize), maxColumn = Math.floor(Math.max(a.x, b.x) / cellSize);
      const minRow = Math.floor(Math.min(a.y, b.y) / cellSize), maxRow = Math.floor(Math.max(a.y, b.y) / cellSize);
      for (let row = minRow; row <= maxRow; row++) for (let column = minColumn; column <= maxColumn; column++) {
        if (!corridor.has(row * columns + column)) valid = false;
      }
    }
    if (!valid) { result.rejectedRouteIds.push(route.id); continue; }
    const rectangles = (width: number): CountryRoadRasterRect[] => {
      const output: CountryRoadRasterRect[] = [], half = Math.floor(width / 2);
      for (let at = 1; at < route.points.length; at++) {
        const a = { x: Math.round(route.points[at - 1]!.x * rasterScale), y: Math.round(route.points[at - 1]!.y * rasterScale) };
        const b = { x: Math.round(route.points[at]!.x * rasterScale), y: Math.round(route.points[at]!.y * rasterScale) };
        output.push({ x: Math.min(a.x, b.x) - half, y: Math.min(a.y, b.y) - half,
          width: Math.abs(a.x - b.x) + width, height: Math.abs(a.y - b.y) + width });
      }
      return output;
    };
    const indices = [...corridor].sort((a, b) => a - b);
    const clipRects = indices.map(index => ({ x: index % columns * cellSize * rasterScale,
      y: Math.floor(index / columns) * cellSize * rasterScale, width: cellSize * rasterScale, height: cellSize * rasterScale }));
    const asphaltRects = rectangles(COUNTRY_ROAD_ASPHALT_PIXELS), pavementRects = rectangles(COUNTRY_ROAD_PAVEMENT_PIXELS);
    result.routes.push({ id: route.id, clipRects, asphaltRects, pavementRects });
    indices.forEach(index => allCells.add(index));
    result.rectCount += asphaltRects.length + pavementRects.length;
  }
  result.corridorCellCount = allCells.size;
  return result;
}

/** Paint a snapshot once. Shared global pattern phase keeps every junction
 * seamless; drawing all asphalt last prevents pavement overwriting another road. */
export function drawCountryRoadRaster(context: CountryRoadRasterContext, plan: CountryRoadRasterPlan,
  materials: { asphalt: CanvasRenderingContext2D["fillStyle"]; pavement: CanvasRenderingContext2D["fillStyle"] }): void {
  for (const layer of ["pavement", "asphalt"] as const) for (const route of plan.routes) {
    context.save();
    context.imageSmoothingEnabled = false;
    context.beginPath();
    for (const rect of route.clipRects) context.rect(rect.x, rect.y, rect.width, rect.height);
    context.clip(); context.fillStyle = materials[layer];
    for (const rect of layer === "pavement" ? route.pavementRects : route.asphaltRects) context.fillRect(rect.x, rect.y, rect.width, rect.height);
    context.restore();
  }
}
