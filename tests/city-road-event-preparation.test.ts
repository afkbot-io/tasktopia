import { describe, expect, it } from "vitest";
import { createCityMobility, prepareCityMobilityNetworkAsync } from "../src/client/city-mobility";
import { buildMobilityNetwork } from "../src/client/city-mobility-network";
import { prepareRoadEventGeometrySteps } from "../src/client/city-road-event-geometry";
import { prepareCooperatively } from "../src/client/cooperative-preparation";
import type { Cell, RoadCellDto } from "../src/shared/contracts";

const key = (cell: Cell) => `${cell.x},${cell.y}`;
function streetGrid(offsets: readonly number[], read: (x: number) => void = () => undefined) {
  const roads = new Map<string, RoadCellDto>();
  for (const offset of offsets) for (const axis of [0, 20, 40]) {
    for (let s = -1; s <= 41; s += 1) for (const band of [-1, 0, 1]) {
      for (const cell of [{ x: s + offset, y: axis + band }, { x: axis + band + offset, y: s }]) {
        roads.set(key(cell), {
          get x() { read(cell.x); return cell.x; },
          get y() { read(cell.x); return cell.y; },
          roadClass: "LOCAL",
        } as RoadCellDto);
      }
    }
  }
  return roads;
}
const population = { walkGraph: new Map<string, Cell>(), crosswalks: new Set<string>(), activityCells: new Set<string>(), seed: 73, carLimit: 1, walkerLimit: 0 };

describe("prepared road event geometry", () => {
  it("reuses static distant geometry after construction while returning the same real reachable sites", () => {
    let denyDistant = false, occupiedLeft = false;
    const roads = streetGrid([0, 1000], x => {
      if (denyDistant && (x < 500) !== occupiedLeft) throw new Error("Static coordinates rescanned after preparation");
    });
    const city = createCityMobility({ ...population, roads });
    occupiedLeft = city.agents[0]!.current.x < 500;
    const before = JSON.stringify(city.roadEventSites());
    expect(JSON.parse(before).length).toBeGreaterThan(0);
    denyDistant = true;
    let after = "";
    expect(() => { after = JSON.stringify(city.roadEventSites()); }).not.toThrow();
    expect(after).toBe(before);
    expect(city.metrics.networkBuilds).toBe(1);
  });

  it("returns fresh public arrays and tow points without corrupting the next call", () => {
    const city = createCityMobility({ ...population, roads: streetGrid([0]), carLimit: 12 });
    const before = JSON.stringify(city.roadEventSites());
    const sites = city.roadEventSites();
    const tow = sites.find(site => site.towCell)!;
    expect(tow).toBeTruthy();
    tow.towCell!.x = 9999;
    sites[0]!.cells.length = 0;
    sites[0]!.responseCells.length = 0;
    expect(JSON.stringify(city.roadEventSites())).toBe(before);
  });

  it("checks current closures and responder availability without rebuilding geometry", () => {
    const city = createCityMobility({ ...population, roads: streetGrid([0]) });
    const before = JSON.stringify(city.roadEventSites());
    const first = city.roadEventSites()[0]!;
    const closed = new Set(first.cells.map(key));
    city.setRoadClosures(closed);
    expect(city.roadEventSites().every(site => site.cells.every(cell => !closed.has(key(cell))))).toBe(true);
    city.setRoadClosures(new Set());
    expect(JSON.stringify(city.roadEventSites())).toBe(before);
    expect(city.dispatchResponse("POLICE", first.responseCells)).toBe(true);
    expect(city.roadEventSites()).toEqual([]);
    city.clearResponses();
    expect(city.roadEventSites().length).toBeGreaterThan(0);
    expect(city.metrics.networkBuilds).toBe(1);
  });

  it("adopts replacement geometry prepared from the same mutated source map", async () => {
    const roads = streetGrid([0]);
    const city = createCityMobility({ ...population, roads });
    expect(city.roadEventSites().length).toBeGreaterThan(0);
    roads.clear();
    for (const [id, cell] of streetGrid([2000])) roads.set(id, cell);
    const replacement = await prepareCityMobilityNetworkAsync({ ...population, roads }, { yieldTask: () => Promise.resolve() });
    city.updateNetworkPrepared(replacement);
    const sites = city.roadEventSites();
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.every(site => site.cells.every(cell => cell.x >= 1999))).toBe(true);
    expect(city.metrics.networkBuilds).toBe(2);
  });

  it("cooperatively cancels the static road phase before reading another slice", async () => {
    let reads = 0;
    const roads = streetGrid([0, 1000], () => { reads += 1; });
    const network = buildMobilityNetwork({ ...population, roads });
    const controller = new AbortController(), reason = new Error("Road geometry cancelled");
    let clock = 0, readsAtAbort = -1, slices = 0;
    await expect(prepareCooperatively(prepareRoadEventGeometrySteps(network), {
      signal: controller.signal,
      now: () => { clock += 1; return clock; },
      yieldTask: () => {
        slices += 1; readsAtAbort = reads;
        controller.abort(reason); return Promise.resolve();
      },
    })).rejects.toBe(reason);
    expect(slices).toBe(1);
    expect(reads).toBe(readsAtAbort);
  });

  it("can cancel from a static coordinate probe within one local neighborhood", async () => {
    const controller = new AbortController(), reason = new Error("Road probe cancelled");
    let armed = false, reads = 0;
    const roads = streetGrid([0], () => {
      if (!armed) return;
      reads += 1;
      if (reads === 1) controller.abort(reason);
    });
    const network = buildMobilityNetwork({ ...population, roads });
    armed = true;
    await expect(prepareCooperatively(prepareRoadEventGeometrySteps(network), {
      signal: controller.signal, now: () => 0, yieldTask: () => Promise.resolve(),
    })).rejects.toBe(reason);
    expect(reads).toBeLessThan(121);
    expect(reads).toBeGreaterThan(0);
  });
});
