import { describe, expect, it } from "vitest";
import { compileBlockLayout, type BlockLayoutCompilerInput } from "../src/server/world/block-layout-compiler";
import { blockSlots } from "../src/shared/block-templates";

const spec = (count: number): BlockLayoutCompilerInput => ({ countryId: "civic-country", cityId: "civic-city", seed: 7, revision: 1,
  districts: [{ id: "civic-sprint", archetype: "MIXED_URBAN", sequence: 0,
    tasks: Array.from({ length: count }, (_, i) => ({ id: `task-${i + 1}`, taskNumber: i + 1,
      buildingFamily: "compact-apartment-v1", facadeVariant: "south", constructionStage: 5 as const })) }] });

describe("city administration reservation", () => {
  it("reserves one civic task after18occupied blocks, without phantom tasks or relocating existing slots", () => {
    const input = spec(160);
    const layout = compileBlockLayout(input);
    const civic = layout.placements.filter(p => String(p.serviceRole) === "CIVIC");
    expect(civic).toHaveLength(1);
    const number = Number(civic[0]!.taskId.split("-")[1]);
    const before = compileBlockLayout(spec(number - 1));
    expect(new Set(before.placements.map(p => p.blockId)).size).toBeGreaterThanOrEqual(18);
    expect(before.placements.some(p => String(p.serviceRole) === "CIVIC")).toBe(false);
    expect(before.blocks.flatMap(blockSlots).filter(s => String(s.serviceRole) === "CIVIC")).toHaveLength(1);
    expect(layout.placements).toHaveLength(160);
    expect(layout.blocks.every(b => layout.placements.some(p => p.blockId === b.id))).toBe(true);
    const next = compileBlockLayout({ ...spec(161), previous: layout, revision: 2 });
    expect(next.placements).toEqual(expect.arrayContaining(layout.placements));
    expect(next.placements.filter(p => String(p.serviceRole) === "CIVIC")).toHaveLength(1);
  });
});
