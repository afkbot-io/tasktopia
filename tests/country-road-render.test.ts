import { describe, expect, it } from "vitest";
import type { CountryOverviewDto } from "../src/shared/country-overview-contract";
import { COUNTRY_ROAD_ATLAS_TILES, drawCountryRoadRaster, planCountryRoadRaster, type CountryRoadRasterContext, type CountryRoadRasterRect } from "../src/client/country-road-render";

const geography: CountryOverviewDto["geography"] = { columns: 2, rows: 1, cellSize: 4, topology: "SQUARE_4", terrainCodes: "08", territoryCodes: "10" };
const roads: CountryOverviewDto["groundRoads"] = { revision: 1, unavailable: [], routes: [{ id: "edge", fromCityId: "a", toCityId: "b",
  points: [{ x: 3.75, y: 1 }, { x: 3.75, y: 3 }], corridorCells: [0] }] };

function recordingRaster() {
  const pixels = new Map<string, CountryRoadRasterContext["fillStyle"]>();
  const layers: CountryRoadRasterContext["fillStyle"][] = [];
  const smoothing: boolean[] = [];
  let path: CountryRoadRasterRect[] = [], clip: CountryRoadRasterRect[] = [];
  const stack: Array<{ clip: CountryRoadRasterRect[]; style: CountryRoadRasterContext["fillStyle"]; smoothing: boolean }> = [];
  const context: CountryRoadRasterContext = {
    fillStyle: "original", imageSmoothingEnabled: true,
    save: () => { stack.push({ clip, style: context.fillStyle, smoothing: context.imageSmoothingEnabled }); },
    restore: () => { const saved = stack.pop()!; clip = saved.clip; context.fillStyle = saved.style; context.imageSmoothingEnabled = saved.smoothing; },
    beginPath: () => { path = []; },
    rect: (x, y, width, height) => { path.push({ x, y, width, height }); },
    clip: () => { clip = [...path]; },
    fillRect: (x, y, width, height) => {
      layers.push(context.fillStyle); smoothing.push(context.imageSmoothingEnabled);
      for (let py = y; py < y + height; py++) for (let px = x; px < x + width; px++) {
        if (clip.some(rect => px >= rect.x && px < rect.x + rect.width && py >= rect.y && py < rect.y + rect.height)) {
          pixels.set(`${px}:${py}`, context.fillStyle);
        }
      }
    },
  };
  return { context, pixels, layers, smoothing };
}

describe("shared-atlas country road raster", () => {
  it("plans crisp3px asphalt and5px pavement with an inherited dry-cell clip", () => {
    const plan = planCountryRoadRaster(roads, geography, 4);
    expect(plan.rejectedRouteIds).toEqual([]);
    expect(plan.routes).toHaveLength(1);
    expect(plan.routes[0]!.clipRects).toEqual([{ x: 0, y: 0, width: 16, height: 16 }]);
    expect(plan.routes[0]!.asphaltRects).toEqual([{ x: 14, y: 3, width: 3, height: 11 }]);
    expect(plan.routes[0]!.pavementRects).toEqual([{ x: 13, y: 2, width: 5, height: 13 }]);
    expect(plan.routes.flatMap(route => [...route.clipRects, ...route.asphaltRects, ...route.pavementRects])
      .every(rect => Object.values(rect).every(Number.isInteger))).toBe(true);
    expect(COUNTRY_ROAD_ATLAS_TILES.asphalt).toMatchObject({ url: "atlas/road-v2/road.png", tileSize: 8, mask: 15 });
    expect(COUNTRY_ROAD_ATLAS_TILES.pavement).toMatchObject({ url: "atlas/road-v2/surface.png", tileSize: 8, mask: 15 });
  });

  it("clips every painted pixel out of neighboring water, including square caps and pavement", () => {
    const plan = planCountryRoadRaster(roads, geography), raster = recordingRaster();
    drawCountryRoadRaster(raster.context, plan, { asphalt: "asphalt", pavement: "pavement" });
    expect(raster.pixels.size).toBeGreaterThan(0);
    expect([...raster.pixels.keys()].every(key => {
      const [x, y] = key.split(":").map(Number); return x! >= 0 && x! < 16 && y! >= 0 && y! < 16;
    })).toBe(true);
    expect(raster.pixels.get("14:8")).toBe("asphalt");
    expect(raster.pixels.get("13:8")).toBe("pavement");
    expect(raster.pixels.has("16:8")).toBe(false);
    expect(raster.smoothing.every(value => value === false)).toBe(true);
    expect(raster.context.fillStyle).toBe("original");
    expect(raster.context.imageSmoothingEnabled).toBe(true);
  });

  it("keeps intersections asphalt by painting every pavement layer first", () => {
    const dry = { ...geography, columns: 1, terrainCodes: "0", territoryCodes: "1" };
    const crossing = { ...roads, routes: [
      { ...roads.routes[0]!, id: "horizontal", points: [{ x: 1, y: 2 }, { x: 3, y: 2 }] },
      { ...roads.routes[0]!, id: "vertical", points: [{ x: 2, y: 1 }, { x: 2, y: 3 }] },
    ] };
    const plan = planCountryRoadRaster(crossing, dry), raster = recordingRaster();
    drawCountryRoadRaster(raster.context, plan, { asphalt: "asphalt", pavement: "pavement" });
    expect(raster.layers).toEqual(["pavement", "pavement", "asphalt", "asphalt"]);
    expect(raster.pixels.get("8:8")).toBe("asphalt");
    expect([6, 7, 8, 9, 10].map(x => raster.pixels.get(`${x}:4`))).toEqual(["pavement", "asphalt", "asphalt", "asphalt", "pavement"]);
    expect(plan.corridorCellCount).toBe(1);
    expect(plan.rectCount).toBe(4);
  });

  it("rejects water, unknown, missing corridor cells and diagonal routes as whole paths", () => {
    for (const input of [
      { ...roads.routes[0]!, corridorCells: [0, 1] },
      { ...roads.routes[0]!, points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] },
      { ...roads.routes[0]!, points: [{ x: 1, y: 1 }, { x: 5, y: 1 }] },
    ]) {
      const result = planCountryRoadRaster({ ...roads, routes: [input] }, geography);
      expect(result.routes).toEqual([]); expect(result.rejectedRouteIds).toEqual(["edge"]);
    }
    for (const terrainCodes of ["0a", "0", "0z"]) expect(planCountryRoadRaster({ ...roads, routes: [
      { ...roads.routes[0]!, corridorCells: [0, 1] },
    ] }, { ...geography, terrainCodes }).routes).toEqual([]);
  });

  it("keeps geometry unchanged and performs no drawing for an empty network", () => {
    const before = JSON.stringify({ roads, geography });
    planCountryRoadRaster(roads, geography);
    expect(JSON.stringify({ roads, geography })).toBe(before);
    const empty = planCountryRoadRaster({ ...roads, routes: [] }, geography), raster = recordingRaster();
    drawCountryRoadRaster(raster.context, empty, { asphalt: "asphalt", pavement: "pavement" });
    expect(empty).toEqual({ routes: [], rejectedRouteIds: [], corridorCellCount: 0, rectCount: 0 });
    expect(raster.layers).toEqual([]);
  });
});
