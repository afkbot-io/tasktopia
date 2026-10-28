import { describe, expect, it, vi } from "vitest";
import { rasterizeBlockRoads } from "../src/shared/road-raster";
import { rasterizeBlockRoadsBeforeAxisStamping as reference } from "./fixtures/road-raster-before-axis-stamping";
import type { Rect } from "../src/shared/contracts";
import type { OrthogonalDirection, SemanticRoadNetwork, SemanticRoadSegment } from "../src/shared/semantic-road";

const segment = (direction: OrthogonalDirection, length: number, widthCells: number, x = -32, y = -16,
  roadClass: SemanticRoadSegment["roadClass"] = "LOCAL", structure?: "ROAD" | "BRIDGE"): SemanticRoadSegment => ({
  id: `${x}:${y}:${direction}:${widthCells}:${roadClass}:${structure}`, fromNodeId: "from", toNodeId: "to",
  roadClass, widthCells, structure, geometry: { start: { x, y }, runs: [{ direction, length }] },
});
const network = (...segments: SemanticRoadSegment[]): SemanticRoadNetwork => ({ schemaVersion: 1, nodes: [], segments });
const directions: OrthogonalDirection[] = ["N", "E", "S", "W"];
const widths = [1, 3, 5, 7, 9];

describe("road raster retains exact geometry with bounded axial work", () => {
  it.each([3, 7, 9])("looks up every straight width%s output coordinate at most once", width => {
    const input = network(segment("E", 128, width, 0, 0));
    const expected = reference(input);
    const original = Map.prototype.get;
    let lookups = 0;
    const spy = vi.spyOn(Map.prototype, "get").mockImplementation(function (this: Map<unknown, unknown>, key: unknown) {
      lookups++;
      return original.call(this, key);
    });
    let result;
    try { result = rasterizeBlockRoads(input); } finally { spy.mockRestore(); }
    expect(result).toEqual(expected);
    // One unique-cell lookup replaces width overlapping square stamps per
    // interior cell. Count actual work independently of wall-clock noise.
    expect(lookups).toBeLessThanOrEqual(expected.length);
  });

  it.each(directions.flatMap(direction => widths.map(width => [direction, width] as const)))(
    "matches full caps, clipped edge masks and negative coordinates for %s width%s", (direction, width) => {
      const input = network(segment(direction, 39, width));
      for (const bounds of [undefined, { minX: -52, minY: -29, maxX: -20, maxY: -4 },
        { minX: -33, minY: -17, maxX: -31, maxY: -15 }, { minX: 100, minY: 100, maxX: 110, maxY: 110 }]) {
        expect(rasterizeBlockRoads(input, bounds)).toEqual(reference(input, bounds));
      }
    });

  it("preserves turn caps, T/X junctions, mixed ranks and bridge precedence in either segment order", () => {
    const bend = segment("E", 20, 3, -40, -30);
    bend.geometry.runs.push({ direction: "S", length: 20 }, { direction: "W", length: 12 }, { direction: "N", length: 5 });
    const segments = [bend, segment("E", 40, 7, -50, -20, "ARTERIAL"), segment("N", 30, 3, -30, -5, "SERVICE", "BRIDGE"),
      segment("W", 25, 5, -10, -20, "COLLECTOR"), segment("S", 20, 9, -20, -40, "LOCAL", "ROAD")];
    for (const list of [segments, [...segments].reverse()]) for (const bounds of [undefined,
      { minX: -42, minY: -31, maxX: -18, maxY: -9 }]) expect(rasterizeBlockRoads(network(...list), bounds)).toEqual(reference(network(...list), bounds));
  });

  it("preserves zero/one-length runs and a degenerate one-cell crop", () => {
    for (const direction of directions) for (const length of [0, 1]) for (const width of widths) {
      const input = network(segment(direction, length, width));
      const bounds = { minX: -32, minY: -16, maxX: -32, maxY: -16 };
      expect(rasterizeBlockRoads(input)).toEqual(reference(input));
      expect(rasterizeBlockRoads(input, bounds)).toEqual(reference(input, bounds));
    }
  });

  it("matches the frozen raster over deterministic mixed networks and disjoint crops", () => {
    let seed = 10000;
    const random = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
    for (let iteration = 0; iteration < 20; iteration++) {
      const input = network(...Array.from({ length: 12 }, () => segment(directions[random(4)]!, random(40) + 1,
        widths[random(widths.length)]!, random(100) - 60, random(100) - 60,
        (["LOCAL", "COLLECTOR", "ARTERIAL", "SERVICE"] as const)[random(4)]!, random(3) === 0 ? "BRIDGE" : undefined)));
      const bounds: Array<Rect | undefined> = [undefined, { minX: -40, minY: -40, maxX: 10, maxY: 10 },
        { minX: 0, minY: -30, maxX: 30, maxY: 30 }];
      for (const crop of bounds) expect(rasterizeBlockRoads(input, crop)).toEqual(reference(input, crop));
    }
  });
});
