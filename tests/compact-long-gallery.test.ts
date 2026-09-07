import { describe, expect, it } from "vitest";
import authoredCatalog from "../assets/pixel-city-pack/catalog/buildings.json";
import { compileBlockLayout, type BlockLayoutTaskInput } from "../src/server/world/block-layout-compiler";
import { blockSlots, blockTemplate, buildingBlockCandidates, createBlockSitePlan } from "../src/shared/block-templates";
import type { BlockSitePlan } from "../src/shared/block-parcel-plan";
import type { CityBlockV1, CompiledBlockLayoutV1 } from "../src/shared/block-world";
import { COMPACT_BUILDING_SHAPES, STRUCTURAL_BUILDING_FAMILIES_V2,
  compactBuildingShapeFamily, compactFamilyMatchesFootprint, compactHomeFamily } from "../src/shared/compact-building-families";
import { BUILDING_CATALOG } from "../src/shared/catalog";
import { constructionStageLayout } from "../src/shared/construction-stage";

const GALLERY = "compact-long-gallery-v1";
const storedBlock: CityBlockV1 = { id: "stored", districtLayoutId: "district", sequence: 0, kind: "RESIDENTIAL",
  templateKey: "residential-court", templateVersion: 2, variant: "south", seed: 17,
  origin: { x: -32, y: 48 }, width: 32, height: 32, parameters: {}, summary: {} };
const oldSitePlan: BlockSitePlan = { version: 1, parcels: [
  { x: 3, y: 3, width: 6, height: 6, clearance: 1, kind: "BUILDING", family: "compact-apartment-v1" },
  { x: 12, y: 3, width: 6, height: 4, clearance: 1, kind: "BUILDING", family: "compact-wide-v1" },
  { x: 3, y: 12, width: 6, height: 3, clearance: 1, kind: "BUILDING", family: "compact-row-v1" },
  { x: 12, y: 12, width: 6, height: 3, clearance: 1, kind: "PARK" },
] };
const task = (n: number, requestedFamily?: string): BlockLayoutTaskInput => ({ id: `task-${n}`, taskNumber: n,
  buildingFamily: "compact-apartment-v1", facadeVariant: "south", constructionStage: 3, visualKind: "BUILDING",
  ...(requestedFamily ? { requestedFamily } : {}) });
const compile = (tasks: BlockLayoutTaskInput[], previous?: CompiledBlockLayoutV1) => compileBlockLayout({
  countryId: "gallery-country", cityId: "gallery-city", seed: 424242, revision: (previous?.revision ?? 0) + 1,
  origin: { x: -32, y: 48 }, previous, districts: [{ id: "sprint", archetype: "MIXED_URBAN", sequence: 0, tasks }],
});
const geometry = (block: CityBlockV1) => blockSlots(block).map(({ buildingFamily, serviceRole, ...slot }) => {
  void buildingFamily; void serviceRole; return slot;
});

describe("independent long gallery geometry and durable slots", () => {
  it("registers one approved 12×6 geometry without changing the immutable v2 vocabulary", () => {
    expect(COMPACT_BUILDING_SHAPES).toHaveProperty(GALLERY, { width: 12, height: 6, floors: 2 });
    expect(STRUCTURAL_BUILDING_FAMILIES_V2).toEqual(["compact-apartment-v1", "compact-row-v1", "compact-wide-v1"]);
    expect(STRUCTURAL_BUILDING_FAMILIES_V2.map(key => COMPACT_BUILDING_SHAPES[key])).toEqual([
      { width: 6, height: 6, floors: 3 }, { width: 6, height: 3, floors: 1 }, { width: 6, height: 4, floors: 2 },
    ]);
  });

  it("maps actual reviewed catalog art to its own footprint, never a stretched six-cell alias", () => {
    const authored = authoredCatalog.buildings.find(entry => entry.key === GALLERY);
    expect(authored).toMatchObject({ category: "HOUSE", rarity: "RARE", platform: "STONE", serviceRole: null,
      estimates: [3, 6], spriteSize: [96, 48], footprintCells: [12, 6], anchorPx: [48, 48],
      entrances: [{ side: "S", offset: 6 }], reviewed: true });
    const published = BUILDING_CATALOG.find(entry => entry.key === GALLERY);
    expect(published).toMatchObject({ footprint: { width: 12, height: 6 }, spriteSize: { width: 96, height: 48 },
      anchor: { x: 48, y: 48 }, entrances: [{ side: "S", offset: 6 }] });
    expect(published!.stages).toHaveLength(5);
    expect(new Set(published!.stages).size).toBe(5);
    expect(compactBuildingShapeFamily(GALLERY)).toBe(GALLERY);
    expect(compactFamilyMatchesFootprint(GALLERY, 12, 6)).toBe(true);
    expect(compactFamilyMatchesFootprint(GALLERY, 6, 6)).toBe(false);
    expect(compactFamilyMatchesFootprint(GALLERY, 6, 12)).toBe(false);
    expect(compactHomeFamily(12, 6, 0)).toBe(GALLERY);
  });

  it.each(["NW", "NE", "SW", "SE"] as const)("packs the real long shape from %s with disjoint clearance and a connected entrance", corner => {
    const candidates = buildingBlockCandidates(0, { width: 12, height: 6 });
    expect(candidates.map(item => item.key)).toEqual([
      "residential-court", "residential-row", "residential-pair", "residential-square", "residential-strip",
    ]);
    for (const candidate of candidates) {
      const block = { ...storedBlock, templateKey: candidate.key, width: candidate.widthModules * 8,
        height: candidate.heightModules * 8, parameters: { firstFamily: GALLERY, packingCorner: corner, infill: true } };
      const sitePlan = createBlockSitePlan(block);
      expect(sitePlan).toEqual(createBlockSitePlan(block));
      const slots = blockSlots({ ...block, templateVersion: 3, parameters: { ...block.parameters, sitePlan } });
      expect(slots[0]).toMatchObject({ buildingFamily: GALLERY });
      expect(slots[0]!.footprint).toHaveLength(72);
      const occupied = new Map<string, string>();
      for (const slot of slots) {
        for (let y = slot.siteBounds.minY; y <= slot.siteBounds.maxY; y++) for (let x = slot.siteBounds.minX; x <= slot.siteBounds.maxX; x++) {
          expect(occupied.has(`${x},${y}`)).toBe(false); occupied.set(`${x},${y}`, slot.key);
        }
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
    const small = blockTemplate("residential-single");
    expect(() => createBlockSitePlan({ ...storedBlock, templateKey: small.key, width: 16, height: 16,
      parameters: { firstFamily: GALLERY } })).toThrow(/fit/i);
  });

  it("can include the gallery in new default v3 parcels without changing the first default house", () => {
    const families = new Set<string | undefined>();
    for (let seed = 0; seed < 32; seed++) {
      const plan = createBlockSitePlan({ ...storedBlock, seed });
      expect(plan.parcels[0]).toMatchObject({ family: "compact-apartment-v1", width: 6, height: 6 });
      plan.parcels.forEach(parcel => families.add(parcel.family));
    }
    expect(families.has(GALLERY)).toBe(true);
  });

  it("keeps the exact old v2 footprints and entrance coordinates", () => {
    expect(blockSlots(storedBlock).map(slot => [slot.kind, slot.buildingFamily ?? null, slot.origin.x, slot.origin.y,
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

  it("appends a fitting block for an explicit gallery while preserving a stored old v3 site plan", () => {
    const previous = compile([task(1)]);
    const old = previous.blocks[0]!;
    old.parameters.sitePlan = structuredClone(oldSitePlan);
    const saved = structuredClone(previous);
    const next = compile([task(1), task(2, GALLERY)], previous);
    expect(previous).toEqual(saved);
    const retained = next.blocks.find(block => block.id === old.id)!;
    expect(retained.parameters.sitePlan).toEqual(oldSitePlan);
    expect(geometry(retained)).toEqual(geometry(old));
    expect(next.placements.find(placement => placement.taskId === "task-1")).toEqual(previous.placements[0]);
    const gallery = next.placements.find(placement => placement.taskId === "task-2")!;
    expect(gallery.buildingFamily).toBe(GALLERY);
    expect(gallery.blockId).not.toBe(old.id);
    const galleryBlock = next.blocks.find(block => block.id === gallery.blockId)!;
    expect(blockSlots(galleryBlock).find(slot => slot.key === gallery.slotKey)!.footprint).toHaveLength(72);
  });

  it("keeps the same gallery site through stages3–5 and composes its full stages1–2 separately", () => {
    let layout = compile([task(1, GALLERY)]);
    const block = structuredClone(layout.blocks[0]!);
    for (const constructionStage of [4, 5] as const) {
      layout = compile([{ ...task(1, GALLERY), constructionStage }], layout);
      expect(layout.blocks[0]!.parameters.sitePlan).toEqual(block.parameters.sitePlan);
      expect(geometry(layout.blocks[0]!)).toEqual(geometry(block));
      expect(layout.placements[0]).toMatchObject({ buildingFamily: GALLERY, constructionStage });
    }
    const slot = blockSlots(block)[0]!;
    const width = slot.footprintBounds.maxX - slot.origin.x + 1, height = slot.footprintBounds.maxY - slot.origin.y + 1;
    const first = constructionStageLayout({ width, height }, slot.entrance.x - slot.origin.x, 1, 42);
    const second = constructionStageLayout({ width, height }, slot.entrance.x - slot.origin.x, 2, 42);
    expect(first.site).toEqual([]); expect(first.details).toEqual([]);
    expect(second.site).toHaveLength(72);
    expect(second.rearFence).toEqual(first.rearFence); expect(second.frontFence).toEqual(first.frontFence);
    expect(second.details.map(detail => detail.key)).toEqual(expect.arrayContaining([
      "compact-construction-crane", "compact-construction-hut", "compact-construction-bricks",
    ]));
    expect(first.frontFence.filter(tile => tile.key === "compact-construction-gate").map(tile => tile.x)).toEqual([5, 6]);
    expect(constructionStageLayout({ width, height }, 6, 5).frontFence).toEqual([]);
  });
});
