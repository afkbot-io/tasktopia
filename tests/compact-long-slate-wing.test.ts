import { describe, expect, it } from "vitest";
import authoredCatalog from "../assets/pixel-city-pack/catalog/buildings.json";
import approvedGeometry from "../assets/pixel-city-pack/reference/ai-authored/compact-long-slate-wing-v1/geometry.json";
import { compileBlockLayout, type BlockLayoutTaskInput } from "../src/server/world/block-layout-compiler";
import { blockSlots, buildingBlockCandidates, createBlockSitePlan } from "../src/shared/block-templates";
import type { BlockSitePlan } from "../src/shared/block-parcel-plan";
import type { CityBlockV1, CompiledBlockLayoutV1 } from "../src/shared/block-world";
import { COMPACT_BUILDING_SHAPES, STRUCTURAL_BUILDING_FAMILIES_V2,
  compactBuildingShapeFamily, compactFamilyMatchesFootprint, compactHomeFamily } from "../src/shared/compact-building-families";
import { BUILDING_CATALOG } from "../src/shared/catalog";
import { constructionStageLayout } from "../src/shared/construction-stage";

const WING = "compact-long-slate-wing-v1";
const oldBlock: CityBlockV1 = { id: "old", districtLayoutId: "sprint-layout", sequence: 0, kind: "RESIDENTIAL",
  templateKey: "residential-court", templateVersion: 2, variant: "south", seed: 17,
  origin: { x: -32, y: 48 }, width: 32, height: 32, parameters: {}, summary: {} };
// A recorded pre-wing V3 plan, not regenerated using the current shape pool.
const oldSitePlan: BlockSitePlan = { version: 1, parcels: [
  { x: 3, y: 3, width: 6, height: 6, clearance: 1, kind: "BUILDING", family: "compact-apartment-v1" },
  { x: 12, y: 3, width: 6, height: 4, clearance: 1, kind: "BUILDING", family: "compact-wide-v1" },
  { x: 3, y: 12, width: 6, height: 3, clearance: 1, kind: "BUILDING", family: "compact-row-v1" },
  { x: 12, y: 12, width: 6, height: 3, clearance: 1, kind: "PARK" },
] };
const task = (number: number, requestedFamily?: string, constructionStage: 3 | 4 | 5 = 3): BlockLayoutTaskInput => ({
  id: `task-${number}`, taskNumber: number, buildingFamily: "compact-apartment-v1", facadeVariant: "south",
  visualKind: "BUILDING", constructionStage, ...(requestedFamily ? { requestedFamily } : {}),
});
const compile = (tasks: BlockLayoutTaskInput[], previous?: CompiledBlockLayoutV1) => compileBlockLayout({
  countryId: "wing-country", cityId: "wing-city", seed: 424242, origin: oldBlock.origin,
  revision: (previous?.revision ?? 0) + 1, previous,
  districts: [{ id: "sprint", archetype: "MIXED_URBAN", sequence: 0, tasks }],
});
const spatialSlots = (block: CityBlockV1) => blockSlots(block).map(({ siteBounds, footprint, entrance, accessPath }) => ({
  siteBounds, footprint, entrance, accessPath,
}));

describe("independently authored north-south long slate wing", () => {
  it("registers its approved 6×12 envelope without extending or changing the V2 vocabulary", () => {
    expect(approvedGeometry).toMatchObject({ footprintCells: [6, 12], spriteSize: [48, 96],
      anchorPx: [24, 96], floorCount: 2, entrances: [{ side: "S", offset: 3 }] });
    expect(COMPACT_BUILDING_SHAPES).toHaveProperty(WING, { width: 6, height: 12, floors: 2 });
    expect(STRUCTURAL_BUILDING_FAMILIES_V2).toEqual(["compact-apartment-v1", "compact-row-v1", "compact-wide-v1"]);
    expect(STRUCTURAL_BUILDING_FAMILIES_V2.map(key => COMPACT_BUILDING_SHAPES[key])).toEqual([
      { width: 6, height: 6, floors: 3 }, { width: 6, height: 3, floors: 1 }, { width: 6, height: 4, floors: 2 },
    ]);
  });

  it("publishes its own five-stage geometry, never rotating or stretching the horizontal gallery", () => {
    expect(authoredCatalog.buildings.find(entry => entry.key === WING)).toMatchObject({
      category: "HOUSE", rarity: "RARE", platform: "STONE", serviceRole: null, estimates: [3, 6],
      spriteSize: [48, 96], footprintCells: [6, 12], anchorPx: [24, 96],
      entrances: [{ side: "S", offset: 3 }], ruleIds: ["STANDARD"], reviewed: true,
    });
    const published = BUILDING_CATALOG.find(entry => entry.key === WING);
    expect(published).toMatchObject({ footprint: { width: 6, height: 12 }, spriteSize: { width: 48, height: 96 },
      anchor: { x: 24, y: 96 }, entrances: [{ side: "S", offset: 3 }] });
    expect(published!.stages).toHaveLength(5);
    expect(new Set(published!.stages).size).toBe(5);
    expect(compactBuildingShapeFamily(WING)).toBe(WING);
    expect(compactFamilyMatchesFootprint(WING, 6, 12)).toBe(true);
    expect(compactFamilyMatchesFootprint(WING, 12, 6)).toBe(false);
    expect(compactFamilyMatchesFootprint(WING, 6, 6)).toBe(false);
    expect(compactHomeFamily(6, 12, 0)).toBe(WING);
  });

  it.each(["NW", "NE", "SW", "SE"] as const)("packs upright from %s with disjoint envelopes and a connected south entrance", packingCorner => {
    const candidates = buildingBlockCandidates(0, { width: 6, height: 12 });
    expect(candidates.map(candidate => candidate.key)).toContain("residential-tower");
    expect(candidates.map(candidate => candidate.key)).not.toContain("residential-strip");
    expect(candidates.map(candidate => candidate.key)).not.toContain("residential-single");
    for (const candidate of candidates) {
      const block = { ...oldBlock, templateKey: candidate.key, width: candidate.widthModules * 8,
        height: candidate.heightModules * 8, parameters: { firstFamily: WING, packingCorner, infill: true } };
      const sitePlan = createBlockSitePlan(block);
      expect(sitePlan).toEqual(createBlockSitePlan(block));
      const stored = { ...block, templateVersion: 3, parameters: { ...block.parameters, sitePlan } };
      const slots = blockSlots(stored), first = slots[0]!;
      expect(first.buildingFamily).toBe(WING);
      expect(first.footprint).toHaveLength(72);
      expect(first.footprintBounds.maxX - first.footprintBounds.minX + 1).toBe(6);
      expect(first.footprintBounds.maxY - first.footprintBounds.minY + 1).toBe(12);
      expect(first.siteBounds).toEqual({ minX: first.origin.x - 1, minY: first.origin.y - 1,
        maxX: first.origin.x + 6, maxY: first.origin.y + 12 });
      expect(first.entrance).toEqual({ x: first.origin.x + 3, y: first.origin.y + 11 });
      const occupied = new Map<string, string>();
      for (const slot of slots) for (let y = slot.siteBounds.minY; y <= slot.siteBounds.maxY; y++)
        for (let x = slot.siteBounds.minX; x <= slot.siteBounds.maxX; x++) {
          expect(occupied.has(`${x},${y}`)).toBe(false); occupied.set(`${x},${y}`, slot.key);
        }
      for (const slot of slots) {
        expect(slot.accessPath[0]).toEqual({ x: slot.entrance.x, y: slot.entrance.y + 1 });
        for (const [index, point] of slot.accessPath.entries()) {
          expect([undefined, slot.key]).toContain(occupied.get(`${point.x},${point.y}`));
          if (index) expect(Math.abs(point.x - slot.accessPath[index - 1]!.x)
            + Math.abs(point.y - slot.accessPath[index - 1]!.y)).toBe(1);
        }
        const end = slot.accessPath.at(-1)!;
        expect(end.x === block.origin.x + 2 || end.y === block.origin.y + 2
          || end.x === block.origin.x + block.width - 2 || end.y === block.origin.y + block.height - 2).toBe(true);
      }
      const reloaded: CityBlockV1 = JSON.parse(JSON.stringify(stored));
      reloaded.seed = 98765; reloaded.parameters.packingCorner = packingCorner === "NW" ? "SE" : "NW";
      reloaded.parameters.firstFamily = "compact-row-v1"; reloaded.parameters.infill = false;
      expect(blockSlots(reloaded)).toEqual(slots);
    }
  });

  it("retains independently recorded V2 slots, entrances and the absence of vertical wings", () => {
    expect(blockSlots(oldBlock).map(slot => [slot.kind, slot.buildingFamily ?? null, slot.origin.x, slot.origin.y,
      slot.footprint.length, slot.entrance.x, slot.entrance.y])).toEqual([
      ["BUILDING", "compact-apartment-v1", -28, 52, 36, -25, 57],
      ["BUILDING", "compact-row-v1", -28, 61, 18, -25, 63],
      ["BUILDING", "compact-row-v1", -28, 67, 18, -25, 69],
      ["PARK", null, -28, 73, 24, -25, 76],
      ["BUILDING", "compact-wide-v1", -19, 52, 24, -16, 55],
      ["BUILDING", "compact-row-v1", -19, 59, 18, -16, 61],
      ["BUILDING", "compact-apartment-v1", -19, 65, 36, -16, 70],
      ["PARK", null, -19, 74, 18, -16, 76],
      ["BUILDING", "compact-apartment-v1", -10, 52, 36, -7, 57],
      ["BUILDING", "compact-apartment-v1", -10, 61, 36, -7, 66],
      ["BUILDING", "compact-wide-v1", -10, 70, 24, -7, 73],
    ]);
  });

  it("appends a fitting vertical parcel without replanning a recorded older V3 block", () => {
    const previous = compile([task(1)]), old = previous.blocks[0]!;
    old.parameters.sitePlan = structuredClone(oldSitePlan);
    const saved = structuredClone(previous);
    const next = compile([task(1), task(2, WING)], previous);
    expect(previous).toEqual(saved);
    const retained = next.blocks.find(block => block.id === old.id)!;
    expect(retained.parameters.sitePlan).toEqual(oldSitePlan);
    expect(spatialSlots(retained)).toEqual(spatialSlots(old));
    expect(next.placements.find(placement => placement.taskId === "task-1")).toEqual(previous.placements[0]);
    const wing = next.placements.find(placement => placement.taskId === "task-2")!;
    expect(wing.buildingFamily).toBe(WING);
    expect(wing.blockId).not.toBe(old.id);
    const slot = blockSlots(next.blocks.find(block => block.id === wing.blockId)!).find(slot => slot.key === wing.slotKey)!;
    expect(slot.footprint).toHaveLength(72);
    expect(slot.footprintBounds.maxY - slot.origin.y + 1).toBe(12);
    expect(compile([task(1), task(2, WING)], JSON.parse(JSON.stringify(previous)))).toEqual(next);
  });

  it("keeps one 72-cell site across authored stages and the separate procedural fence/crane stages", () => {
    let layout = compile([task(1, WING)]);
    const original = structuredClone(layout);
    for (const stage of [4, 5] as const) {
      layout = compile([task(1, WING, stage)], layout);
      expect(layout.blocks).toEqual(original.blocks);
      expect(layout.placements[0]).toEqual({ ...original.placements[0], constructionStage: stage });
    }
    const slot = blockSlots(layout.blocks[0]!)[0]!;
    expect(slot.footprint).toHaveLength(72);
    const first = constructionStageLayout({ width: 6, height: 12 }, 3, 1, 42);
    const second = constructionStageLayout({ width: 6, height: 12 }, 3, 2, 42);
    expect(first.site).toEqual([]); expect(first.details).toEqual([]);
    expect(second.site).toHaveLength(72);
    expect(second.rearFence).toEqual(first.rearFence); expect(second.frontFence).toEqual(first.frontFence);
    expect(second.details.map(detail => detail.key)).toEqual(expect.arrayContaining([
      "compact-construction-crane", "compact-construction-hut", "compact-construction-bricks",
    ]));
    expect(first.frontFence.filter(tile => tile.key === "compact-construction-gate").map(tile => tile.x)).toEqual([2, 3]);
    expect(constructionStageLayout({ width: 6, height: 12 }, 3, 5).frontFence).toEqual([]);
  });
});
