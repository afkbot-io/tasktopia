import { describe, expect, it } from "vitest";
import { blockSlots, createBlockSitePlan, BLOCK_TEMPLATES } from "../src/shared/block-templates";
import type { CityBlockV1 } from "../src/shared/block-world";
import { compileBlockLayout } from "../src/server/world/block-layout-compiler";

const block = (corner: string): CityBlockV1 => ({ id: "b", districtLayoutId: "d", sequence: 0,
  kind: "RESIDENTIAL", templateKey: "residential-pair", templateVersion: 2,
  variant: "south", seed: 17, origin: { x: 0, y: 0 }, width: 24, height: 32,
  parameters: { packingCorner: corner, infill: true }, summary: {} });

describe("directional block infill", () => {
  it("keeps sites disjoint and south gates connected for every house template, corner and a seed corpus", () => {
    for (const template of BLOCK_TEMPLATES.filter(t => t.kind === "BUILDING")) for (const corner of ["NW", "NE", "SW", "SE"]) {
      for (let seed = 0; seed < 8; seed++) {
        const sample = { ...block(corner), seed, templateKey: template.key, width: template.widthModules * 8, height: template.heightModules * 8 };
        const slots = blockSlots(sample);
        const occupied = new Set<string>();
        for (const slot of slots) {
          for (let y = slot.siteBounds.minY; y <= slot.siteBounds.maxY; y++) for (let x = slot.siteBounds.minX; x <= slot.siteBounds.maxX; x++) {
            if (occupied.has(`${x},${y}`)) throw new Error(`Site collision ${template.key}/${corner}/${seed}`);
            occupied.add(`${x},${y}`);
          }
        }
        const footprints = new Set(slots.flatMap(s => s.footprint.map(p => `${p.x},${p.y}`)));
        for (const slot of slots) {
          expect(slot.accessPath[0]).toEqual({ x: slot.entrance.x, y: slot.entrance.y + 1 });
          const end = slot.accessPath.at(-1)!;
          expect(end.x === 2 || end.y === 2 || end.x === sample.width - 2 || end.y === sample.height - 2).toBe(true);
          expect(slot.accessPath.every(p => !footprints.has(`${p.x},${p.y}`))).toBe(true);
        }
      }
    }
  });
  it("leaves thin residual strips outside new durable task parcels", () => {
    for (const template of BLOCK_TEMPLATES.filter(t => t.kind === "BUILDING")) {
      for (const corner of ["NW", "NE", "SW", "SE"]) for (let seed = 0; seed < 8; seed++) {
        const sample = { ...block(corner), seed, templateKey: template.key, width: template.widthModules * 8, height: template.heightModules * 8 };
        const plan = createBlockSitePlan(sample);
        for (const parcel of plan.parcels) {
          expect(parcel.width).toBeGreaterThanOrEqual(3);
          expect(parcel.height).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });
  it("preserves a previously stored one-cell v3 park", () => {
    const saved = { ...block("NW"), templateVersion: 3, parameters: { infill: true, sitePlan: {
      version: 1, parcels: [{ x: 3, y: 3, width: 1, height: 8, clearance: 0, kind: "PARK" }],
    } } };
    const slots = blockSlots(saved);
    expect(slots).toHaveLength(1);
    expect(slots[0]!.footprint).toEqual(Array.from({ length: 8 }, (_, i) => ({ x: 3, y: 3 + i })));
    expect(blockSlots(JSON.parse(JSON.stringify(saved)))).toEqual(slots);
  });
  it("uses varied block sizes and persists corner/infill policy for newly created blocks", () => {
    const input = { countryId: "c", cityId: "city", seed: 17, revision: 1, districts: [{ id: "d", archetype: "PRIVATE", sequence: 0,
      tasks: Array.from({ length: 130 }, (_, i) => ({ id: `t${i}`, taskNumber: i + 1, buildingFamily: "compact-apartment-v1", facadeVariant: "south", constructionStage: 5 as const })) }] };
    const layout = compileBlockLayout(input);
    expect(new Set(layout.blocks.map(b => `${b.width}x${b.height}`)).size).toBeGreaterThanOrEqual(5);
    expect(new Set(layout.blocks.map(b => b.parameters.packingCorner)).size).toBe(4);
    expect(layout.blocks.every(b => b.parameters.infill === true)).toBe(true);
    const replay = compileBlockLayout({ ...input, previous: layout, revision: 2 });
    expect(replay.placements).toEqual(layout.placements);
    expect(replay.blocks.map(blockSlots)).toEqual(layout.blocks.map(blockSlots));
  });
  it("starts from four different corners without turning the south-facing buildings", () => {
    const first = ["NW", "NE", "SW", "SE"].map(corner => blockSlots(block(corner))[0]!);
    expect(new Set(first.map(s => `${s.origin.x},${s.origin.y}`)).size).toBe(4);
    for (const slot of first) expect(slot.entrance.y).toBe(slot.footprintBounds.maxY);
  });
  it("reserves the unused right-hand strip as task-owned rectangular parks and keeps every route open", () => {
    const slots = blockSlots(block("NW"));
    expect(slots.some(s => s.kind === "PARK" && s.siteBounds.minX >= 20)).toBe(true);
    const sites = new Set<string>();
    for (const s of slots) for (let y = s.siteBounds.minY; y <= s.siteBounds.maxY; y++)
      for (let x = s.siteBounds.minX; x <= s.siteBounds.maxX; x++) {
        expect(sites.has(`${x},${y}`)).toBe(false); sites.add(`${x},${y}`);
      }
    const footprints = new Set(slots.flatMap(s => s.footprint.map(p => `${p.x},${p.y}`)));
    for (const slot of slots) {
      expect(slot.accessPath.length).toBeGreaterThan(0);
      for (const p of slot.accessPath) expect(footprints.has(`${p.x},${p.y}`)).toBe(false);
    }
    expect(blockSlots(block("NW"))).toEqual(slots);
  });
});
