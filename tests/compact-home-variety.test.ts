import { describe, expect, it } from "vitest";
import { compileBlockLayout } from "../src/server/world/block-layout-compiler";
import { COMPACT_BUILDING_SHAPES, compactBuildingShapeFamily, compactHomeFamily } from "../src/shared/compact-building-families";
import { BUILDING_CATALOG } from "../src/shared/catalog";

const input = {
  countryId: "home-variety", cityId: "home-city", seed: 424242, revision: 1,
  districts: [{ id: "spring", archetype: "MIXED_URBAN", sequence: 0,
    tasks: Array.from({ length: 70 }, (_, i) => ({ id: `home-${i}`, taskNumber: i + 1,
      buildingFamily: "residential", facadeVariant: "south", constructionStage: 5 as const,
      visualKind: "BUILDING" as const })) }],
};

describe("authored home variety on immutable compact slots", () => {
  it.each(["compact-garden-house-v1", "compact-ivory-library-v1", "compact-rust-loft-v1", "compact-sand-balcony-v1",
    "compact-olive-cafe-v1", "compact-plum-workshop-v1", "compact-rose-clinic-annex-v1", "compact-teal-mansard-v1"])(
    "registers the reviewed %s family with five stages on its original envelope", family => {
      const entry = BUILDING_CATALOG.find(building => building.key === family);
      expect(entry).toMatchObject({ category: "HOUSE", footprint: { width: 6, height: 6 },
        spriteSize: { width: 48, height: 48 }, anchor: { x: 24, y: 48 },
        entrances: [{ side: "S", offset: 3 }] });
      expect(entry!.stages).toHaveLength(5);
      expect(new Set(entry!.stages).size).toBe(5);
      expect(compactBuildingShapeFamily(family)).toBe("compact-apartment-v1");
    });
  it("uses each compatible house once before repeating it in a block", () => {
    const used = new Map<string, number>();
    const keys = BUILDING_CATALOG.filter(entry => entry.category === "HOUSE" && !entry.serviceRole
      && entry.footprint.width === 6 && entry.footprint.height === 6).map(entry => entry.key).sort();
    const selected = Array.from({ length: keys.length }, () => {
      const key = compactHomeFamily(6, 6, 0, used)!;
      used.set(key, (used.get(key) ?? 0) + 1);
      return key;
    });
    expect(selected).toEqual(keys);
    expect(compactHomeFamily(6, 6, 0, used)).toBe(keys[0]);
  });

  it("balances automatic house identities within each block", () => {
    const layout = compileBlockLayout(input);
    for (const block of layout.blocks) for (const { width, height } of Object.values(COMPACT_BUILDING_SHAPES)) {
      const keys = BUILDING_CATALOG.filter(entry => entry.category === "HOUSE" && !entry.serviceRole
        && entry.footprint.width === width && entry.footprint.height === height).map(entry => entry.key);
      expect(keys.length).toBeGreaterThan(0);
      const counts = keys.map(key => layout.placements.filter(p => p.blockId === block.id && !p.serviceRole && p.buildingFamily === key).length);
      expect(Math.max(...counts) - Math.min(...counts), `${block.id}/${width}x${height}`).toBeLessThanOrEqual(1);
    }
  });
  it("uses separately authored homes as well as geometry templates", () => {
    const layout = compileBlockLayout(input);
    const newHomes = new Set(BUILDING_CATALOG.filter(entry => entry.category === "HOUSE" && !entry.serviceRole
      && !["compact-apartment-v1", "compact-wide-v1", "compact-row-v1"].includes(entry.key)).map(entry => entry.key));
    expect(new Set(layout.placements.filter(p => newHomes.has(p.buildingFamily)).map(p => p.buildingFamily)).size).toBeGreaterThanOrEqual(6);
    for (const placement of layout.placements) expect(compactBuildingShapeFamily(placement.buildingFamily)).toBeTruthy();
  });

  it("makes every authored home selectable within its own footprint", () => {
    for (const { width, height } of Object.values(COMPACT_BUILDING_SHAPES)) {
      const keys = BUILDING_CATALOG.filter(entry => entry.category === "HOUSE" && !entry.serviceRole
        && entry.footprint.width === width && entry.footprint.height === height).map(entry => entry.key).sort();
      expect(keys.length).toBeGreaterThan(0);
      expect(Array.from({ length: keys.length }, (_, entropy) => compactHomeFamily(width, height, entropy))).toEqual(keys);
    }
  });

  it("keeps old identities, blocks and roads when a later task arrives", () => {
    const previous = compileBlockLayout(input);
    const next = compileBlockLayout({ ...input, revision: 2, previous,
      districts: [{ ...input.districts[0], tasks: [...input.districts[0].tasks,
        { ...input.districts[0].tasks[0], id: "next-home", taskNumber: 71 }] }] });
    for (const placement of previous.placements) {
      expect(next.placements.find(p => p.taskId === placement.taskId)).toEqual(placement);
    }
    for (const block of previous.blocks) {
      const current = next.blocks.find(b => b.id === block.id)!;
      expect([current.origin, current.width, current.height, current.templateKey])
        .toEqual([block.origin, block.width, block.height, block.templateKey]);
    }
  });

  it("uses prior block counts so incremental additions match a bulk compile", () => {
    const previous = compileBlockLayout({ ...input,
      districts: [{ ...input.districts[0], tasks: input.districts[0].tasks.slice(0, 7) }] });
    const incremental = compileBlockLayout({ ...input, revision: 2, previous });
    const bulk = compileBlockLayout(input);
    expect(incremental.placements).toEqual(bulk.placements);
  });

  it("does not count automatic park placeholders as apartment repetitions", () => {
    const catalog = [...BUILDING_CATALOG];
    // A small compatible pool exposes the bias after the first infill slot.
    BUILDING_CATALOG.splice(0, BUILDING_CATALOG.length, ...catalog.filter(entry => entry.category !== "HOUSE"
      || entry.footprint.width !== 6 || entry.footprint.height !== 6
      || ["compact-apartment-v1", "compact-blue-bay-v1"].includes(entry.key)));
    try {
      const automatic = { ...input, districts: [{ ...input.districts[0], tasks: input.districts[0].tasks.map(task => ({
        ...task, buildingFamily: "compact-apartment-v1", autoVisualKind: true,
      })) }] };
      const layout = compileBlockLayout(automatic);
      const alternatePlaceholder = compileBlockLayout({ ...automatic, districts: [{ ...automatic.districts[0],
        tasks: automatic.districts[0].tasks.map(task => ({ ...task, buildingFamily: "non-rendered-park-placeholder" })) }] });
      expect(layout.blocks.map(block => block.parameters.slotFamilies))
        .toEqual(alternatePlaceholder.blocks.map(block => block.parameters.slotFamilies));
      const keys = BUILDING_CATALOG.filter(entry => entry.category === "HOUSE" && !entry.serviceRole
        && entry.footprint.width === 6 && entry.footprint.height === 6).map(entry => entry.key);
      for (const block of layout.blocks) {
        // Mandatory services may use a generic fitting home sprite; they are
        // not residential identity repetitions, just as parks are not homes.
        const families = layout.placements.filter(placement => placement.blockId === block.id && !placement.serviceRole
          && Object.hasOwn(block.parameters.slotFamilies as Record<string, string> ?? {}, placement.slotKey))
          .map(placement => placement.buildingFamily);
        const counts = keys.map(key => families.filter(family => family === key).length);
        expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
      }
      const previous = compileBlockLayout({ ...automatic,
        districts: [{ ...automatic.districts[0], tasks: automatic.districts[0].tasks.slice(0, 12) }] });
      const replay = compileBlockLayout({ ...automatic, revision: 2, previous });
      expect(replay.placements).toEqual(layout.placements);
    } finally { BUILDING_CATALOG.splice(0, BUILDING_CATALOG.length, ...catalog); }
  });
});
