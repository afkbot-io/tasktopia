import { expect, it, vi } from "vitest";
import type { Cell, RoadCellDto, SurfaceCellDto } from "../src/shared/contracts";
import { compactCellRuns, compactRoadRuns, compactSurfaceRuns } from "../src/shared/world-cell-runs";
import * as reference from "./fixtures/world-cell-runs-before-reuse";

it.each([false, true])("sorts cell inputs only after a real inversion (reversed=%s)", reversed => {
  const cells = Array.from({ length: 128 }, (_, i) => Object.freeze({ x: -12 + i % 16, y: -6 + Math.floor(i / 16) }));
  if (reversed) cells.reverse();
  Object.freeze(cells);
  const expected = reference.compactCellRuns(cells);
  const original = Array.prototype.sort;
  let cellSorts = 0, runSorts = 0;
  const spy = vi.spyOn(Array.prototype, "sort").mockImplementation(function (this: unknown[], compare?: (a: unknown, b: unknown) => number) {
    const first = this[0];
    if (first && typeof first === "object") {
      if ("x" in first && "y" in first) cellSorts++;
      if ("start" in first && "end" in first) runSorts++;
    }
    return original.call(this, compare);
  });
  let actual;
  try { actual = compactCellRuns(cells); } finally { spy.mockRestore(); }
  expect(actual).toEqual(expected);
  expect(cellSorts).toBe(reversed ? 1 : 0);
  expect(runSorts).toBe(1); // The final canonical run ordering is still sorted.
});

it("keeps private start/end points distinct and never borrows or mutates input coordinates", () => {
  for (const cells of [Array.from({ length: 40 }, (_, x) => ({ x, y: -8 })),
    Array.from({ length: 40 }, (_, y) => ({ x: -5, y }))]) {
    const frozen = Object.freeze(cells.map(cell => Object.freeze(cell)));
    const result = compactCellRuns(frozen), expected = reference.compactCellRuns(frozen);
    expect(result).toEqual(expected);
    const inputPoints = new Set(frozen), resultPoints = result.flatMap(run => [run.start, run.end]);
    expect(new Set(resultPoints).size).toBe(resultPoints.length);
    expect(resultPoints.some(point => inputPoints.has(point))).toBe(false);
    const before = { ...result[0]!.start };
    result[0]!.end.x += 100; result[0]!.end.y += 100;
    expect(result[0]!.start).toEqual(before);
    expect(frozen).toEqual(cells);
  }
});

it("matches the frozen public helpers for empty, axial, rectangle, holes, negatives and duplicate coordinates", () => {
  const fixtures: Cell[][] = [[], [{ x: -1, y: -1 }],
    Array.from({ length: 30 }, (_, x) => ({ x: x - 15, y: -8 })),
    Array.from({ length: 30 }, (_, y) => ({ x: -5, y: y - 15 })),
    Array.from({ length: 120 }, (_, i) => ({ x: -10 + i % 12, y: -6 + Math.floor(i / 12) })),
    [{ x: -3, y: -3 }, { x: -3, y: -2 }, { x: -3, y: -2 }, { x: -1, y: -2 }, { x: 0, y: 0 }]];
  for (const fixture of fixtures) for (const cells of [fixture, [...fixture].reverse()]) {
    const roads: RoadCellDto[] = cells.map((cell, n) => ({ ...cell, mask: n % 16,
      structure: n % 3 === 0 ? "BRIDGE" : "ROAD", roadClass: n % 2 ? "LOCAL" : "ARTERIAL" }));
    const surfaces: SurfaceCellDto[] = cells.map((cell, n) => ({ ...cell, kind: n % 3 ? "PATH" : "SIDEWALK",
      ...(n % 2 ? { finish: undefined } : { finish: "PAVERS" as const }) }));
    expect(compactCellRuns(cells)).toEqual(reference.compactCellRuns(cells));
    expect(compactRoadRuns(roads)).toEqual(reference.compactRoadRuns(roads));
    expect(compactSurfaceRuns(surfaces)).toEqual(reference.compactSurfaceRuns(surfaces));
  }
});

it("preserves stable equal-coordinate metadata and exact JSON across deterministic shuffled pages", () => {
  let seed = 10000;
  const random = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  for (let iteration = 0; iteration < 24; iteration++) {
    const cells = Array.from({ length: 180 }, () => ({ x: random(40) - 20, y: random(20) - 10 }));
    const roads: RoadCellDto[] = cells.map((cell, index) => ({ ...cell, mask: index % 16,
      roadClass: (["LOCAL", "COLLECTOR", "ARTERIAL", "HIGHWAY"] as const)[random(4)]!,
      structure: random(3) === 0 ? "BRIDGE" : "ROAD" }));
    const surfaces: SurfaceCellDto[] = cells.map(cell => ({ ...cell,
      kind: random(3) ? "PATH" : "SIDEWALK", ...(random(2) ? { finish: undefined } : {}) }));
    for (const input of [cells, [...cells].sort((a, b) => a.y - b.y || a.x - b.x)]) {
      expect(JSON.stringify(compactCellRuns(input))).toBe(JSON.stringify(reference.compactCellRuns(input)));
    }
    expect(JSON.stringify(compactRoadRuns(roads))).toBe(JSON.stringify(reference.compactRoadRuns(roads)));
    expect(JSON.stringify(compactSurfaceRuns(surfaces))).toBe(JSON.stringify(reference.compactSurfaceRuns(surfaces)));
  }
});
