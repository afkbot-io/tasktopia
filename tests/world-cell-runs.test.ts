import { describe, expect, it } from "vitest";
import type { RoadCellDto, SurfaceCellDto } from "../src/shared/contracts";
import { compactCellRuns, compactRoadRuns, compactSurfaceRuns, expandCellRuns, expandRoadRuns, expandSurfaceRuns } from "../src/shared/world-cell-runs";

const sorted = <T extends { x: number; y: number }>(cells: T[]) => [...cells].sort((a, b) => a.y - b.y || a.x - b.x);

describe("compact world read-model runs", () => {
  it("round-trips cell ownership using horizontal or vertical endpoints", () => {
    const cells = [
      ...Array.from({ length: 9 }, (_, y) => ({ x: 3, y })),
      ...Array.from({ length: 7 }, (_, x) => ({ x: 8 + x, y: 12 })),
    ];
    const runs = compactCellRuns(cells);

    expect(runs).toHaveLength(2);
    expect(sorted(expandCellRuns(runs))).toEqual(sorted(cells));
    expect(JSON.stringify(runs).length).toBeLessThan(JSON.stringify(cells).length / 2);
  });

  it("round-trips roads without transporting one object per square", () => {
    const roads: RoadCellDto[] = [
      ...Array.from({ length: 16 }, (_, x) => ({ x, y: 4, mask: 10, structure: "ROAD" as const, roadClass: "LOCAL" as const })),
      ...Array.from({ length: 12 }, (_, y) => ({ x: 20, y, mask: 5, structure: "ROAD" as const, roadClass: "ARTERIAL" as const })),
    ];
    const runs = compactRoadRuns(roads);

    expect(runs).toHaveLength(2);
    expect(sorted(expandRoadRuns(runs))).toEqual(sorted(roads));
  });

  it("keeps surface kind and finish while compacting paths", () => {
    const surfaces: SurfaceCellDto[] = Array.from({ length: 20 }, (_, x) => ({
      x, y: 8, kind: "PATH" as const, finish: "PAVERS" as const,
    }));

    const runs = compactSurfaceRuns(surfaces);
    expect(runs).toHaveLength(1);
    expect(expandSurfaceRuns(runs)).toEqual(surfaces);
  });

  it("does not join a horizontal run to a vertical tail as a diagonal", () => {
    const surfaces: SurfaceCellDto[] = [
      { x: 0, y: 0, kind: "PATH", finish: "PAVERS" },
      { x: 1, y: 0, kind: "PATH", finish: "PAVERS" },
      { x: 2, y: 0, kind: "PATH", finish: "PAVERS" },
      { x: 2, y: 1, kind: "PATH", finish: "PAVERS" },
      { x: 2, y: 2, kind: "PATH", finish: "PAVERS" },
    ];

    const runs = compactSurfaceRuns(surfaces);
    expect(runs).toHaveLength(2);
    expect(sorted(expandSurfaceRuns(runs))).toEqual(sorted(surfaces));
  });
});
