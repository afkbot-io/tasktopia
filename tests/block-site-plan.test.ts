import { describe, expect, it } from "vitest";
import { compileBlockLayout, type BlockLayoutCompilerInput } from "../src/server/world/block-layout-compiler";
import { BLOCK_TEMPLATES, blockSlots, createBlockSitePlan } from "../src/shared/block-templates";
import type { BlockSitePlan } from "../src/shared/block-parcel-plan";
import type { CityBlockV1 } from "../src/shared/block-world";
import { BUILDING_CATALOG, getBuilding, type EntranceSide } from "../src/shared/catalog";

const input = (count = 1): BlockLayoutCompilerInput => ({ countryId: "country", cityId: "city", seed: 7, revision: 1,
  districts: [{ id: "sprint", sequence: 0, archetype: "MIXED_URBAN", tasks: Array.from({ length: count }, (_, i) => ({
    id: `task-${i + 1}`, taskNumber: i + 1, buildingFamily: "compact-apartment-v1", facadeVariant: "south", constructionStage: 5,
  })) }] });

describe("durable block parcel plans", () => {
  it("reserves the requested edge entrance before filling a new narrow block", () => {
    const block: CityBlockV1 = { id: "edge-entry", districtLayoutId: "district", sequence: 4,
      kind: "RESIDENTIAL", templateKey: "residential-strip", templateVersion: 3, variant: "south", seed: 0,
      origin: { x: 0, y: 0 }, width: 24, height: 16, summary: {},
      parameters: { entrancePolicyVersion: 1, buildingProfile: "NEW_BUILD", buildingProfileVersion: 1,
        firstFamily: "compact-wide-v1", packingCorner: "NW", infill: true },
    };
    const family = "compact-color-kindergarten-v1";
    const sitePlan = createBlockSitePlan(block, family);
    const slots = blockSlots({ ...block, parameters: { ...block.parameters, sitePlan, slotFamilies: { "slot-0": family } } });
    expect(slots[0]!.accessPath.length).toBeGreaterThan(1);
    expect(slots[0]!.entrance.x).toBe(slots[0]!.footprintBounds.maxX);
    expect(slots.filter(slot => slot.kind === "PARK").every(park => slots[0]!.accessPath.every(cell =>
      !park.footprint.some(occupied => occupied.x === cell.x && occupied.y === cell.y)))).toBe(true);
  });
  it("skips a fitting parcel when its east approach is sealed by a neighbour", () => {
    const family = { ...getBuilding("compact-apartment-v1"), key: "test-east-house",
      entrances: [{ side: "E" as const, offset: 2 }] };
    BUILDING_CATALOG.push(family);
    try {
      const previous = compileBlockLayout(input());
      const block = previous.blocks[0]!;
      block.templateKey = "residential-court"; block.width = 32; block.height = 32;
      block.parameters.slotFamilies = { "slot-1": "compact-apartment-v1" };
      block.parameters.sitePlan = { version: 1, parcels: [
        { x: 3, y: 3, width: 6, height: 6, clearance: 1, kind: "BUILDING", family: "compact-apartment-v1" },
        { x: 11, y: 3, width: 6, height: 6, clearance: 1, kind: "BUILDING", family: "compact-apartment-v1" },
      ] };
      previous.placements[0]!.slotKey = "slot-1";
      previous.placements[0]!.buildingFamily = "compact-apartment-v1";
      const original = structuredClone(previous);
      const request = input(2);
      request.districts[0]!.tasks[1]!.requestedFamily = family.key;
      const next = compileBlockLayout({ ...request, revision: 2, previous });
      expect(next.placements.find(p => p.taskId === "task-2")!.blockId).not.toBe(block.id);
      expect(next.blocks.find(b => b.id === block.id)!.parameters).toEqual(block.parameters);
      expect(previous).toEqual(original);
      expect(() => next.blocks.forEach(blockSlots)).not.toThrow();
    } finally { BUILDING_CATALOG.splice(BUILDING_CATALOG.indexOf(family), 1); }
  });
  it.each([
    ["S", 1, [15, 29], [15, 30]], ["S", 4, [18, 29], [18, 30]],
    ["N", 1, [15, 24], [15, 23]], ["N", 4, [18, 24], [18, 23]],
    ["W", 1, [14, 25], [13, 25]], ["W", 4, [14, 28], [13, 28]],
    ["E", 1, [19, 25], [20, 25]], ["E", 4, [19, 28], [20, 28]],
  ] as const)("connects a %s entrance at offset %i to the sidewalk", (side, offset, door, approach) => {
    const family = { ...getBuilding("compact-apartment-v1"), key: "test-directional-house",
      entrances: [{ side: side as EntranceSide, offset }] };
    BUILDING_CATALOG.push(family);
    try {
      const block: CityBlockV1 = { id: "directional", districtLayoutId: "district", sequence: 0,
        kind: "RESIDENTIAL", templateKey: "residential-court", templateVersion: 3, variant: "south", seed: 0,
        origin: { x: 10, y: 20 }, width: 32, height: 32,
        parameters: { slotFamilies: { "slot-0": family.key }, sitePlan: { version: 1, parcels: [
          { x: 3, y: 3, width: 6, height: 6, clearance: 1, kind: "BUILDING", family: "compact-apartment-v1" },
        ] } }, summary: {} };
      const slot = blockSlots(block)[0]!;
      expect(slot.entrance).toEqual({ x: door[0], y: door[1] });
      expect(slot.accessPath[0]).toEqual({ x: approach[0], y: approach[1] });
      expect(slot.accessPath.every(c => !slot.footprint.some(f => f.x === c.x && f.y === c.y))).toBe(true);
      for (let i = 1; i < slot.accessPath.length; i++) {
        const a = slot.accessPath[i - 1]!, b = slot.accessPath[i]!;
        expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBe(1);
      }
      const end = slot.accessPath.at(-1)!;
      expect(end.x === 12 || end.x === 40 || end.y === 22 || end.y === 50).toBe(true);
      expect(blockSlots(JSON.parse(JSON.stringify(block)))).toEqual([slot]);
      const request = input();
      request.districts[0]!.tasks[0]!.requestedFamily = family.key;
      const layout = compileBlockLayout(request);
      const placement = layout.placements[0]!;
      const assignedBlock = layout.blocks.find(b => b.id === placement.blockId)!;
      const assigned = blockSlots(assignedBlock).find(s => s.key === placement.slotKey)!;
      expect(assigned.buildingFamily).toBe(family.key);
      expect(assigned.accessPath[0]!.x - assigned.entrance.x).toBe(side === "W" ? -1 : side === "E" ? 1 : 0);
      expect(assigned.accessPath[0]!.y - assigned.entrance.y).toBe(side === "N" ? -1 : side === "S" ? 1 : 0);
      const reloaded = compileBlockLayout({ ...request, revision: 2, previous: JSON.parse(JSON.stringify(layout)) });
      expect(reloaded.placements).toEqual(layout.placements);
    } finally {
      BUILDING_CATALOG.splice(BUILDING_CATALOG.indexOf(family), 1);
    }
  });
  it("keeps the frozen v2 column geometry while new v3 shapes remain available", () => {
    const block: CityBlockV1 = { id: "old", districtLayoutId: "old-district", sequence: 0,
      kind: "RESIDENTIAL", templateKey: "residential-court", templateVersion: 2, variant: "south", seed: 0,
      origin: { x: -32, y: 48 }, width: 32, height: 32, parameters: {}, summary: {} };
    // Independent recorded v2 geometry: three six-cell-wide columns, nine-cell
    // horizontal pitch and the original apartment/row/wide vocabulary only.
    expect(blockSlots(block).map(slot => [slot.buildingFamily, slot.origin.x, slot.origin.y,
      slot.footprintBounds.maxY - slot.footprintBounds.minY + 1, slot.entrance.x, slot.entrance.y])).toEqual([
      ["compact-apartment-v1", -28, 52, 6, -25, 57], ["compact-row-v1", -28, 61, 3, -25, 63],
      ["compact-apartment-v1", -28, 67, 6, -25, 72], ["compact-apartment-v1", -19, 52, 6, -16, 57],
      ["compact-wide-v1", -19, 61, 4, -16, 64], ["compact-wide-v1", -19, 68, 4, -16, 71],
      ["compact-apartment-v1", -10, 52, 6, -7, 57], ["compact-wide-v1", -10, 61, 4, -7, 64],
      ["compact-apartment-v1", -10, 68, 6, -7, 73],
    ]);
  });
  it("replays persisted v3 geometry independently of later packing hints across every template and corner", () => {
    const base = compileBlockLayout(input()).blocks[0]!;
    for (const template of BLOCK_TEMPLATES) for (const corner of ["NW", "NE", "SW", "SE"])
      for (let seed = 0; seed < 16; seed++) {
        const block = { ...base, templateVersion: 2, templateKey: template.key, width: template.widthModules * 8, height: template.heightModules * 8,
          seed, parameters: { packingCorner: corner, infill: true } };
        const plan = createBlockSitePlan(block);
        const stored = { ...block, templateVersion: 3, parameters: { ...block.parameters, sitePlan: plan } };
        const existing = blockSlots(stored);
        const reloaded = JSON.parse(JSON.stringify(stored)) as CityBlockV1;
        reloaded.seed = 99999;
        reloaded.parameters.packingCorner = corner === "NW" ? "SE" : "NW";
        reloaded.parameters.infill = false;
        expect(blockSlots(reloaded)).toEqual(existing);
      }
  });
  it("stores every new parcel including public-space infill and ignores later packing hints", () => {
    const layout = compileBlockLayout(input()), block = layout.blocks[0]!;
    const plan = block.parameters.sitePlan as BlockSitePlan;
    expect(plan?.version).toBe(1);
    const original = blockSlots(block);
    expect(plan.parcels).toHaveLength(original.length);
    expect(plan.parcels.some(p => p.kind === "PARK" && p.clearance === 0)).toBe(true);
    const reloaded = JSON.parse(JSON.stringify(block));
    reloaded.seed = 999; reloaded.parameters.packingCorner = "NW"; reloaded.parameters.infill = false;
    reloaded.parameters.firstFamily = "compact-row-v1";
    expect(blockSlots(reloaded)).toEqual(original);
    const expanded = compileBlockLayout({ ...input(30), previous: layout, revision: 2 });
    expect(expanded.blocks[0]!.parameters.sitePlan).toEqual(plan);
    expect(expanded.placements).toEqual(expect.arrayContaining(layout.placements));
    expect(expanded.blocks.every(b => (b.parameters.sitePlan as BlockSitePlan)?.version === 1)).toBe(true);
  });
  it("does not replan existing blocks without explicit plans", () => {
    const layout = compileBlockLayout(input());
    for (const block of layout.blocks) { delete block.parameters.sitePlan; block.templateVersion = 2; }
    const before = layout.blocks.map(blockSlots);
    const expanded = compileBlockLayout({ ...input(30), previous: layout, revision: 2 });
    expect(expanded.blocks[0]!.parameters.sitePlan).toBeUndefined();
    // Placement metadata may grow; spatial records must not.
    const geometry = (slots: ReturnType<typeof blockSlots>) => slots.map(({ siteBounds, footprint, entrance, accessPath }) => ({ siteBounds, footprint, entrance, accessPath }));
    expect(geometry(blockSlots(expanded.blocks[0]!))).toEqual(geometry(before[0]!));
    expect(expanded.placements).toEqual(expect.arrayContaining(layout.placements));
  });
  it("requires a plan for v3 and rejects a v3 plan disguised as an older block", () => {
    const block = compileBlockLayout(input()).blocks[0]!;
    expect(() => blockSlots({ ...block, templateVersion: 2 })).toThrow(/site plan version/);
    delete block.parameters.sitePlan;
    expect(() => blockSlots(block)).toThrow(/site plan version/);
  });
  it.each([
    (p: BlockSitePlan) => { p.version = 2 as 1; },
    (p: BlockSitePlan) => { p.parcels[0]!.x = -1; },
    (p: BlockSitePlan) => { p.parcels[0]!.height = 1e9; },
    (p: BlockSitePlan) => { p.parcels[0]!.clearance = 0; },
    (p: BlockSitePlan) => { p.parcels[0]!.family = "unapproved-house"; },
    (p: BlockSitePlan) => { p.parcels.push({ ...p.parcels[0]! }); },
  ])("rejects invalid persisted plans instead of regenerating them", mutate => {
    const block = compileBlockLayout(input()).blocks[0]!;
    const plan = block.parameters.sitePlan as BlockSitePlan;
    expect(plan).toBeDefined(); mutate(plan);
    expect(() => blockSlots(block)).toThrow(/site plan/);
  });
  it("rejects a geometrically valid public parcel whose southern gate is inside another site", () => {
    const block = compileBlockLayout(input()).blocks[0]!;
    block.parameters.slotFamilies = {};
    block.parameters.sitePlan = { version: 1, parcels: [
      { x: 3, y: 3, width: 10, height: 2, clearance: 0, kind: "PARK" },
      { x: 3, y: 5, width: 10, height: 3, clearance: 0, kind: "PARK" },
    ] };
    expect(() => blockSlots(block)).toThrow(/entrance|gate/);
  });
});
