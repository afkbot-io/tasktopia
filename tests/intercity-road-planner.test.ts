import { describe, expect, it } from "vitest";
import { decodeOrthogonalRoadRuns } from "../src/shared/semantic-road";
import { isBuildableTerrain, terrainAt } from "../src/shared/world-terrain";
import { planIntercityRoads, type IntercityRoadCity } from "../src/server/world/intercity-road-planner";

function city(id: string, x: number, y = 0): IntercityRoadCity {
  return { id, blocks: [{ origin: { x, y }, width: 16, height: 16 }],
    nodes: [[0, 0], [8, 0], [16, 0], [0, 8], [16, 8], [0, 16], [8, 16], [16, 16]]
      .map(([dx, dy]) => ({ id: `${id}:${dx}:${dy}`, x: x + dx!, y: y + dy! })) };
}
const dry = () => true;
const input = { countryId: "country", seed: 73, cities: [city("a", 0), city("b", 96)], isBuildable: dry };

describe("bounded canonical intercity roads", () => {
  it("audits only retained roads without searching for missing connections", () => {
    const previous = planIntercityRoads(input);
    const result = planIntercityRoads({ ...input, cities: [...input.cities, city("c", 192)], previous, validateOnly: true });
    expect(result.routes).toEqual(previous.routes);
    expect(result.components).toEqual([["a", "b"], ["c"]]);
    expect(result.metrics).toMatchObject({ candidates: 0, attemptedRoutes: 0, visited: 0 });
    expect(() => planIntercityRoads({ ...input, previous, validateOnly: true, isBuildable: p => p.x !== 41 })).toThrow(/obstructed/);
  });
  it("connects real road nodes with compressed unit-contiguous geometry and protected clearance", () => {
    const result = planIntercityRoads(input);
    expect(result.routes).toHaveLength(1); expect(result.unreachable).toEqual([]);
    const route = result.routes[0]!;
    expect(route.widthCells).toBe(3);
    const path = decodeOrthogonalRoadRuns(route.geometry);
    // Geometry coordinates, not node metadata, are the renderer authority.
    const first = input.cities.find(c => c.id === route.fromCityId)!.nodes.find(n => n.id === route.fromNodeId)!;
    const last = input.cities.find(c => c.id === route.toCityId)!.nodes.find(n => n.id === route.toNodeId)!;
    expect(path[0]).toEqual({ x: first.x, y: first.y });
    expect(path.at(-1)).toEqual({ x: last.x, y: last.y });
    for (const p of path) for (const c of input.cities) for (const b of c.blocks) {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        expect(p.x + dx >= b.origin.x + 3 && p.x + dx <= b.origin.x + b.width - 3
          && p.y + dy >= b.origin.y + 3 && p.y + dy <= b.origin.y + b.height - 3).toBe(false);
      }
    }
  });

  it("does not hide a thin water crossing between otherwise dry8-cell search nodes", () => {
    const result = planIntercityRoads({ ...input, isBuildable: p => p.x !== 41,
      limits: { searchMarginCells: 32, maxVisitedPerRoute: 4000, maxTotalVisited: 8000 } });
    expect(result.routes).toEqual([]);
    expect(result.unreachable).toEqual([{ fromCityId: "a", toCityId: "b", reason: "NO_PATH" }]);
    expect(result.metrics.visited).toBeLessThanOrEqual(8000);
  });

  it("protects the full roadwidth plus clearance, not only its centreline", () => {
    const result = planIntercityRoads({ ...input, isBuildable: p => p.x < 32 || p.x > 72 || Math.abs(p.y) <= 1,
      limits: { searchMarginCells: 16 } });
    expect(result.routes).toEqual([]);
    expect(result.unreachable[0]?.reason).toBe("NO_PATH");
  });

  it("detours around an immutable task site without relocating it", () => {
    const protectedSites = [{ minX: 40, minY: -8, maxX: 64, maxY: 24 }];
    const before = JSON.stringify(protectedSites);
    const result = planIntercityRoads({ ...input, protectedSites });
    expect(result.routes).toHaveLength(1);
    for (const p of decodeOrthogonalRoadRuns(result.routes[0]!.geometry)) {
      expect(p.x >= 38 && p.x <= 66 && p.y >= -10 && p.y <= 26).toBe(false);
    }
    expect(JSON.stringify(protectedSites)).toBe(before);
  });

  it("appends a new connection without changing accepted routes or their identities", () => {
    const first = planIntercityRoads(input);
    const old = JSON.stringify(first.routes);
    const next = planIntercityRoads({ ...input, cities: [...input.cities, city("c", 192)], previous: first });
    expect(next.routes).toHaveLength(2);
    expect(next.routes[0]).toEqual(first.routes[0]);
    expect(JSON.stringify(first.routes)).toBe(old);
    expect(planIntercityRoads({ ...input, cities: [...input.cities, city("c", 192)], previous: next }).routes).toEqual(next.routes);
  });

  it("is deterministic at negative coordinates and independent of input ordering", () => {
    const cities = [city("a", -192, -64), city("b", -96, -64), city("c", -96, 32)];
    const first = planIntercityRoads({ ...input, cities });
    const second = planIntercityRoads({ ...input, cities: [...cities].reverse().map(c => ({ ...c, nodes: [...c.nodes].reverse() })) });
    expect(second).toEqual(first);
    expect(first.routes).toHaveLength(2);
  });

  it("reports visit-budget exhaustion without a fabricated straight road", () => {
    const result = planIntercityRoads({ ...input, cities: [...input.cities, city("c", 192)],
      limits: { maxVisitedPerRoute: 1, maxTotalVisited: 1 } });
    expect(result.routes).toEqual([]);
    expect(result.metrics.visited).toBe(1);
    expect(result.unreachable.some(failure => failure.reason === "TOTAL_BUDGET")).toBe(true);
  });

  it("bounds unique terrain work independently of the visit budget", () => {
    let calls = 0;
    const result = planIntercityRoads({ ...input, isBuildable: () => { calls++; return true; },
      limits: { maxTerrainSamples: 100 } });
    expect(result.routes).toEqual([]);
    expect(result.metrics.terrainSamples).toBe(100);
    expect(calls).toBeLessThanOrEqual(100);
    expect(result.unreachable[0]?.reason).toBe("TOTAL_BUDGET");
  });

  it("uses the existing seeded geography unchanged and validates every default-terrain corridor cell", () => {
    const seed = 424242, cities = [city("a", 0, -64), city("b", 32, -64)];
    const before = JSON.stringify(cities);
    const sample = (point: { x: number; y: number }) => isBuildableTerrain(terrainAt(seed, point.x, point.y).terrain);
    const result = planIntercityRoads({ countryId: "actual-terrain", seed, cities });
    expect(result.routes).toHaveLength(1);
    expect(planIntercityRoads({ countryId: "actual-terrain", seed, cities, isBuildable: sample })).toEqual(result);
    for (const point of decodeOrthogonalRoadRuns(result.routes[0]!.geometry)) {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        expect(sample({ x: point.x + dx, y: point.y + dy })).toBe(true);
      }
    }
    expect(JSON.stringify(cities)).toBe(before);
  });

  it("rejects a new obstruction on accepted geometry rather than relocating the old road", () => {
    const previous = planIntercityRoads(input);
    const before = JSON.stringify(previous);
    const middle = decodeOrthogonalRoadRuns(previous.routes[0]!.geometry)[20]!;
    expect(() => planIntercityRoads({ ...input, previous, protectedSites: [{
      minX: middle.x, maxX: middle.x, minY: middle.y, maxY: middle.y,
    }] })).toThrow(/obstructed/);
    expect(JSON.stringify(previous)).toBe(before);
  });

  it("bounds both newly accepted and retained aggregate geometry", () => {
    const previous = planIntercityRoads(input);
    const limits = { maxGeometrySteps: 40 };
    expect(() => planIntercityRoads({ ...input, previous, limits })).toThrow(/geometry.*aggregate budget/);
    const limited = planIntercityRoads({ ...input, limits });
    expect(limited.routes).toEqual([]);
    expect(limited.unreachable[0]?.reason).toBe("TOTAL_BUDGET");
  });

  it("connects separated dry nearest-four clusters through proven MST-backbone candidates", () => {
    const cities = Array.from({ length: 10 }, (_, i) => city(`city-${i}`, (i < 5 ? 0 : 4096) + i % 5 * 64));
    const result = planIntercityRoads({ ...input, cities });
    expect(result.routes).toHaveLength(9);
    expect(result.components.map(component => component.length)).toEqual([10]);
    expect(result.unreachable).toEqual([]);
    expect(result.metrics.candidates).toBeLessThanOrEqual(cities.length * 5);
  });

  it("reports insufficient total budget for a distant MST candidate without a fake route", () => {
    const cities = Array.from({ length: 10 }, (_, i) => city(`city-${i}`, (i < 5 ? 0 : 4096) + i % 5 * 64));
    const result = planIntercityRoads({ ...input, cities, limits: { maxTotalVisited: 160 } });
    expect(result.components.length).toBeGreaterThan(1);
    expect(result.metrics.visited).toBe(160);
    expect(result.unreachable.some(failure => failure.reason === "TOTAL_BUDGET")).toBe(true);
  });

  it("bounds city count and the aggregate protected index before any terrain search", () => {
    expect(() => planIntercityRoads({ ...input,
      cities: Array.from({ length: 101 }, (_, i) => city(`city-${i}`, i * 64)),
    })).toThrow(/100 cities/);
    const protectedSites = Array.from({ length: 11 }, () => ({ minX: 0, minY: 0, maxX: 6336, maxY: 6336 }));
    expect(() => planIntercityRoads({ ...input, protectedSites })).toThrow(/aggregate.*index.*budget/i);
  });

  it("keeps empty/single-city input valid and rejects untrusted previous identity or off-grid nodes", () => {
    expect(planIntercityRoads({ ...input, cities: [] }).routes).toEqual([]);
    expect(planIntercityRoads({ ...input, cities: [city("a", 0)] }).routes).toEqual([]);
    expect(() => planIntercityRoads({ ...input, previous: { countryId: "other", seed: 73, routes: [] } })).toThrow(/country|seed/i);
    expect(() => planIntercityRoads({ ...input, cities: [city("a", 1), city("b", 96)] })).toThrow(/grid/i);
    expect(() => planIntercityRoads({ ...input, cities: [city("a", 0), city("b", 0)] })).toThrow(/coordinate.*owner/i);
  });
});

describe("explicit bounded river bridges", () => {
  const river = (p: {x:number;y:number}) => p.x >= 40 && p.x <= 52;
  const bridgeInput = {...input, isBuildable:(p: {x:number;y:number})=>!river(p), isBridgeable:river, allowBridges:true};
  it("connects both dry banks with a recorded straight bridge and validates the retained route", () => {
    const result = planIntercityRoads(bridgeInput);
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0]!.bridges).toHaveLength(1);
    const bridge = result.routes[0]!.bridges![0]!;
    expect(bridge.runs).toHaveLength(1);
    expect(bridge.runs[0]!.length).toBeLessThanOrEqual(64);
    const corrupt=structuredClone(result);
    corrupt.routes[0]!.bridges![0]!.runs[0]!.length=1_000_000_000;
    expect(()=>planIntercityRoads({...bridgeInput,previous:corrupt,validateOnly:true})).toThrow(/bridge span/);
    expect(planIntercityRoads({...bridgeInput,previous:result,validateOnly:true}).routes).toEqual(result.routes);
    expect(() => planIntercityRoads({...bridgeInput,previous:result,validateOnly:true,isBridgeable:()=>false})).toThrow(/bridge/);
  });
  it("never turns a long ocean or protected parcel into a bridge", () => {
    const ocean=(p: {x:number;y:number})=>p.x>=24 && p.x<=160;
    expect(planIntercityRoads({...input,cities:[city('a',0),city('b',192)],allowBridges:true,isBuildable:p=>!ocean(p),isBridgeable:ocean}).routes).toEqual([]);
    expect(planIntercityRoads({...bridgeInput,protectedSites:[{minX:40,maxX:52,minY:-1000,maxY:1000}]}).routes).toEqual([]);
  });
});
