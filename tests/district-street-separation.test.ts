import { describe, expect, it } from "vitest";
import { compileBlockLayout, rasterizeBlockRoads, type BlockLayoutCompilerInput } from "../src/server/world/block-layout-compiler";
import { blockSlots } from "../src/shared/block-templates";
import { auditSemanticRoadNetwork } from "../src/shared/semantic-road";
import { districtSeparatorBetween, type DistrictSeparator } from "../src/shared/district-separator";
import { auditBlockLayout } from "../src/server/world/world-audit";

const spec = (): BlockLayoutCompilerInput => ({ countryId: "country", cityId: "city", seed: 7, revision: 1,
  districts: [0, 1, 2].map(d => ({ id: `district-${d}`, sequence: d, archetype: "MIXED_URBAN",
    tasks: [{ id: `task-${d}`, taskNumber: d + 1, buildingFamily: "compact-apartment", facadeVariant: "south", constructionStage: 5 }] })),
});
const interiorsOverlap = (a: { minX: number; minY: number; maxX: number; maxY: number }, b: typeof a) =>
  a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;

describe("reserved district street separators", () => {
  it("separates new sprint groups by an eight-cell corridor, connects both ends and protects every site", () => {
    const layout = compileBlockLayout(spec());
    const corridors = layout.blocks.flatMap(b => b.parameters.districtSeparator ? [b.parameters.districtSeparator as DistrictSeparator] : []);
    expect(corridors).toHaveLength(2);
    expect(auditSemanticRoadNetwork(layout.roadNetwork)).toBe(layout.roadNetwork);
    const roads = new Set(rasterizeBlockRoads(layout.roadNetwork).map(p => `${p.x}:${p.y}`));
    for (const { axis, bounds: b } of corridors) {
      expect(Math.min(b.maxX - b.minX, b.maxY - b.minY)).toBe(8);
      for (const p of [[b.minX, b.minY], [b.maxX, b.minY], [b.minX, b.maxY], [b.maxX, b.maxY]]) expect(roads.has(p.join(":"))).toBe(true);
      if (axis === "H") for (let x = b.minX; x <= b.maxX; x++) {
        expect(roads.has(`${x}:${b.minY}`)).toBe(true); expect(roads.has(`${x}:${b.maxY}`)).toBe(true);
      } else for (let y = b.minY; y <= b.maxY; y++) {
        expect(roads.has(`${b.minX}:${y}`)).toBe(true); expect(roads.has(`${b.maxX}:${y}`)).toBe(true);
      }
    }
    for (const block of layout.blocks) for (const slot of blockSlots(block)) {
      for (let y = slot.siteBounds.minY; y <= slot.siteBounds.maxY; y++) for (let x = slot.siteBounds.minX; x <= slot.siteBounds.maxX; x++) {
        expect(roads.has(`${x}:${y}`)).toBe(false);
      }
    }
  });

  it("keeps an explicit connector axis even for a square8×8 end-overlap", () => {
    const neighbor = compileBlockLayout(spec()).blocks[0]!;
    expect(districtSeparatorBetween({ origin: { x: neighbor.origin.x + neighbor.width - 8, y: neighbor.origin.y + neighbor.height + 8 }, width: 16, height: 16 }, neighbor)?.axis).toBe("V");
    expect(districtSeparatorBetween({ origin: { x: neighbor.origin.x + neighbor.width + 8, y: neighbor.origin.y + neighbor.height - 8 }, width: 16, height: 16 }, neighbor)?.axis).toBe("H");
  });

  it("audits persisted separator tampering instead of silently trusting its JSON", () => {
    const layout = compileBlockLayout(spec());
    expect(auditBlockLayout(layout)).toEqual([]);
    const separator = layout.blocks.find(b => b.parameters.districtSeparator)!.parameters.districtSeparator as DistrictSeparator;
    separator.bounds.maxX++;
    expect(auditBlockLayout(layout)).toContainEqual(expect.objectContaining({ code: "DISTRICT_SEPARATOR_INVALID" }));
    expect(() => compileBlockLayout({ ...spec(), previous: layout, revision: 2 })).toThrow(/Invalid district separator/);
  });

  it("chooses the same separator when previous database block rows arrive in another order", () => {
    for (let seed = 0; seed < 24; seed++) {
      const input = { ...spec(), seed };
      const previous = compileBlockLayout(input);
      input.districts.push({ ...input.districts[0]!, id: "new-district", sequence: 3,
        tasks: [{ ...input.districts[0]!.tasks[0]!, id: "new-district-task", taskNumber: 4 }] });
      const first = compileBlockLayout({ ...input, previous, revision: 2 });
      const second = compileBlockLayout({ ...input, previous: { ...previous, blocks: [...previous.blocks].reverse() }, revision: 2 });
      expect(second).toEqual(first);
    }
  });

  it("retains old plots and approach roads, and never fills a reserved corridor during later growth", () => {
    const input = spec(); const first = compileBlockLayout(input);
    input.districts[0]!.tasks.push(...Array.from({ length: 45 }, (_, i) => ({ ...input.districts[0]!.tasks[0]!, id: `new-${i}`, taskNumber: i + 10 })));
    const next = compileBlockLayout({ ...input, previous: first, revision: 2 });
    for (const old of first.blocks) {
      const current = next.blocks.find(b => b.id === old.id)!;
      expect(current.origin).toEqual(old.origin);
      expect(current.parameters.sitePlan).toEqual(old.parameters.sitePlan);
      expect(current.parameters.districtSeparator).toEqual(old.parameters.districtSeparator);
      expect(current.parameters.slotFamilies).toEqual(expect.objectContaining(old.parameters.slotFamilies));
    }
    expect(next.roadNetwork.segments).toEqual(expect.arrayContaining(first.roadNetwork.segments));
    for (const block of first.blocks) {
      const corridor = block.parameters.districtSeparator as { bounds: { minX: number; minY: number; maxX: number; maxY: number } } | undefined;
      if (!corridor) continue;
      for (const b of next.blocks) expect(interiorsOverlap(corridor.bounds, { minX: b.origin.x, minY: b.origin.y,
        maxX: b.origin.x + b.width, maxY: b.origin.y + b.height })).toBe(false);
    }
  });

  it("does not bridge wet separator terrain, and still permits the compact connected dry-shelf layout", () => {
    const input = spec(); input.districts.pop();
    const withinShelf = (b: { minX: number; minY: number; maxX: number; maxY: number }) =>
      b.minX >= -2 && b.minY >= -2 && b.maxX <= 50 && b.maxY <= 34;
    const layout = compileBlockLayout({ ...input, canPlaceBlock: withinShelf });
    expect(layout.blocks.every(b => !b.parameters.districtSeparator)).toBe(true);
    expect(layout.blocks[1]!.origin).toEqual({ x: 32, y: 0 });
    expect(auditSemanticRoadNetwork(layout.roadNetwork)).toBe(layout.roadNetwork);
  });
});
