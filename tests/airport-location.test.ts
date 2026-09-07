import { describe, expect, it } from "vitest";
import { blockSlotAirportPoint } from "../src/shared/airport-location";
import { blockSlots } from "../src/shared/block-templates";
import { compileBlockLayout } from "../src/server/world/block-layout-compiler";
import { projectCountryCityMiniature } from "../src/server/world/country-overview";

describe("canonical airport endpoints", () => {
  it("uses the physical footprint center for rectangular and negative-coordinate slots", () => {
    expect(blockSlotAirportPoint({ footprintBounds: { minX: -6, maxX: -1, minY: 3, maxY: 5 } }))
      .toEqual({ x: -3, y: 4.5 });
    expect(blockSlotAirportPoint({ footprintBounds: { minX: 4, maxX: 9, minY: -9, maxY: -4 } }))
      .toEqual({ x: 7, y: -6 });
  });

  it("projects the same completed slot point into the country miniature without using its block center", () => {
    const task = (n: number) => ({ id: `task-${n}`, taskNumber: n, buildingFamily: "compact-apartment-v1",
      facadeVariant: "south", constructionStage: 5 as const });
    const layout = compileBlockLayout({ countryId: "country", cityId: "city", seed: 9, revision: 1, origin: { x: -64, y: -32 },
      districts: [0, 1, 2].map(sequence => ({ id: `district-${sequence}`, sequence, archetype: "MIXED_URBAN",
        tasks: sequence === 2 ? [task(3), task(4)] : [task(sequence + 1)] })),
    });
    const placement = layout.placements.find(p => p.serviceRole === "AIRPORT")!;
    const block = layout.blocks.find(b => b.id === placement.blockId)!;
    const slot = blockSlots(block).find(s => s.key === placement.slotKey)!;
    const point = blockSlotAirportPoint(slot);
    expect(point).not.toEqual({ x: block.origin.x + block.width / 2, y: block.origin.y + block.height / 2 });
    const miniature = projectCountryCityMiniature({ sourceBounds: layout.bounds, layout });
    expect(miniature.airports).toEqual([{ taskId: placement.taskId,
      x: (point.x - layout.bounds.minX) / 8, y: (point.y - layout.bounds.minY) / 8 }]);
    const unfinished = { ...layout, placements: layout.placements.map(p => p.taskId === placement.taskId ? { ...p, constructionStage: 4 as const } : p) };
    expect(projectCountryCityMiniature({ sourceBounds: layout.bounds, layout: unfinished }).airports).toEqual([]);
  });
});
