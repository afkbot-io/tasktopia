import { describe, expect, it } from "vitest";
import { compileBlockLayout, type BlockLayoutTaskInput } from "../src/server/world/block-layout-compiler";
import { blockSlots, buildingBlockCandidates, createBlockSitePlan } from "../src/shared/block-templates";
import type { CityBlockV1 } from "../src/shared/block-world";
import { COMPACT_BUILDING_SHAPES, STRUCTURAL_BUILDING_FAMILIES_V2,
  compactBuildingShapeFamily, compactFamilyMatchesFootprint, compactHomeFamily } from "../src/shared/compact-building-families";
import { BUILDING_CATALOG } from "../src/shared/catalog";
import { constructionStageLayout } from "../src/shared/construction-stage";

const COURT = "compact-corner-court-v1";
const IVORY = "compact-ivory-library-v1";
const base: CityBlockV1 = { id: "court", districtLayoutId: "district", sequence: 0, kind: "RESIDENTIAL",
  templateKey: "residential-court", templateVersion: 3, variant: "south", seed: 17,
  origin: { x: -32, y: 48 }, width: 32, height: 32, parameters: {}, summary: {} };
const task = (constructionStage: 3 | 4 | 5): BlockLayoutTaskInput => ({ id: "court-task", taskNumber: 1,
  buildingFamily: COURT, requestedFamily: COURT, facadeVariant: "south", constructionStage, visualKind: "BUILDING" });

describe("independently authored court and ivory homes", () => {
  it("adds a square L-mass envelope without changing old geometry or stretching ivory", () => {
    expect(COMPACT_BUILDING_SHAPES).toHaveProperty(COURT, { width: 8, height: 8, floors: 2 });
    expect(STRUCTURAL_BUILDING_FAMILIES_V2).toEqual(["compact-apartment-v1", "compact-row-v1", "compact-wide-v1"]);
    expect(compactBuildingShapeFamily(COURT)).toBe(COURT);
    expect(compactBuildingShapeFamily(IVORY)).toBe("compact-apartment-v1");
    expect(compactFamilyMatchesFootprint(COURT, 6, 6)).toBe(false);
    expect(compactHomeFamily(8, 8, 0)).toBe(COURT);
    expect(BUILDING_CATALOG.find(entry => entry.key === COURT)).toMatchObject({
      footprint: { width: 8, height: 8 }, spriteSize: { width: 64, height: 64 },
      anchor: { x: 32, y: 64 }, entrances: [{ side: "S", offset: 4 }],
    });
    for (const key of [COURT, IVORY]) {
      const entry = BUILDING_CATALOG.find(entry => entry.key === key)!;
      expect(entry.stages).toHaveLength(5);
      expect(new Set(entry.stages).size).toBe(5);
    }
  });

  it.each(["NW", "NE", "SW", "SE"] as const)("packs the whole courtyard from %s and protects its entrance", packingCorner => {
    const candidates = buildingBlockCandidates(0, { width: 8, height: 8 });
    expect(candidates.length).toBeGreaterThan(1);
    for (const candidate of candidates) {
      const block = { ...base, templateKey: candidate.key, width: candidate.widthModules * 8,
        height: candidate.heightModules * 8, parameters: { firstFamily: COURT, packingCorner, infill: true } };
      const sitePlan = createBlockSitePlan(block);
      expect(sitePlan).toEqual(createBlockSitePlan(block));
      const slots = blockSlots({ ...block, parameters: { ...block.parameters, sitePlan } });
      expect(slots[0]).toMatchObject({ buildingFamily: COURT });
      expect(slots[0]!.footprint).toHaveLength(64);
      const occupied = new Map<string, string>();
      for (const slot of slots) for (let y = slot.siteBounds.minY; y <= slot.siteBounds.maxY; y++)
        for (let x = slot.siteBounds.minX; x <= slot.siteBounds.maxX; x++) {
          expect(occupied.has(`${x},${y}`)).toBe(false); occupied.set(`${x},${y}`, slot.key);
        }
      for (const slot of slots) {
        expect(slot.accessPath[0]).toEqual({ x: slot.entrance.x, y: slot.entrance.y + 1 });
        for (const [i, point] of slot.accessPath.entries()) {
          expect([undefined, slot.key]).toContain(occupied.get(`${point.x},${point.y}`));
          if (i) expect(Math.abs(point.x - slot.accessPath[i - 1]!.x) + Math.abs(point.y - slot.accessPath[i - 1]!.y)).toBe(1);
        }
        const last = slot.accessPath.at(-1)!;
        expect(last.x === block.origin.x + 2 || last.y === block.origin.y + 2
          || last.x === block.origin.x + block.width - 2 || last.y === block.origin.y + block.height - 2).toBe(true);
      }
    }
  });

  it("retains the full opaque court parcel through construction and supplies size-correct fences", () => {
    const input = { countryId: "court-country", cityId: "court-city", seed: 424242, revision: 1,
      districts: [{ id: "sprint", archetype: "MIXED_URBAN", sequence: 0, tasks: [task(3)] }] };
    let layout = compileBlockLayout(input);
    const original = structuredClone(layout);
    for (const constructionStage of [4, 5] as const) {
      layout = compileBlockLayout({ ...input, revision: constructionStage, previous: layout,
        districts: [{ ...input.districts[0], tasks: [task(constructionStage)] }] });
      expect(layout.blocks).toEqual(original.blocks);
      expect(layout.placements[0]).toEqual({ ...original.placements[0], constructionStage });
    }
    const slot = blockSlots(layout.blocks[0]!)[0]!;
    expect(slot.footprint).toHaveLength(64);
    const first = constructionStageLayout({ width: 8, height: 8 }, 4, 1, 42);
    const second = constructionStageLayout({ width: 8, height: 8 }, 4, 2, 42);
    expect(first.site).toEqual([]); expect(first.details).toEqual([]);
    expect(second.site).toHaveLength(64);
    expect(second.rearFence).toEqual(first.rearFence); expect(second.frontFence).toEqual(first.frontFence);
    expect(second.details.map(detail => detail.key)).toEqual(expect.arrayContaining([
      "compact-construction-crane", "compact-construction-hut", "compact-construction-bricks",
    ]));
    expect(first.frontFence.filter(tile => tile.key === "compact-construction-gate").map(tile => tile.x)).toEqual([3, 4]);
    expect(constructionStageLayout({ width: 8, height: 8 }, 4, 5).frontFence).toEqual([]);
  });
});
