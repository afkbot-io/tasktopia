import { describe, expect, it } from "vitest";
import { BLOCK_MODULE_CELLS, BLOCK_TEMPLATES, blockSlots } from "../src/shared/block-templates";
import { getBuilding } from "../src/shared/catalog";
import { compactBuildingShapeFamily } from "../src/shared/compact-building-families";
import { BlockPlacementError, compileBlockLayout, rasterizeBlockRoads, type BlockLayoutCompilerInput } from "../src/server/world/block-layout-compiler";

const task = (n: number) => ({ id: `task-${n}`, taskNumber: n, buildingFamily: "compact-apartment-v1", facadeVariant: "south", constructionStage: 5 as const });
const spec = (count: number): BlockLayoutCompilerInput => ({ countryId: "country", cityId: "city", seed: 7, revision: 1,
  districts: [{ id: "district", archetype: "MIXED_URBAN", sequence: 0, tasks: Array.from({ length: count }, (_, i) => task(i + 1)) }] });

describe("dense mixed rectangular parcels", () => {
  it("keeps every finite template and seeded variant within its clearance and connected aisle contract", () => {
    for (const template of BLOCK_TEMPLATES) for (let seed = 0; seed < 16; seed++) {
      const width = template.widthModules * BLOCK_MODULE_CELLS; const height = template.heightModules * BLOCK_MODULE_CELLS;
      const slots = blockSlots({ id: "block", districtLayoutId: "district", sequence: 0, kind: "RESIDENTIAL", templateKey: template.key,
        templateVersion: 2, seed, variant: "south", origin: { x: 0, y: 0 }, width, height, parameters: {}, summary: {} });
      expect(slots.length).toBeGreaterThan(0);
      const footprints = new Set(slots.flatMap(s => s.footprint.map(p => `${p.x}:${p.y}`)));
      const sites = new Set<string>();
      for (const slot of slots) {
        if (slot.buildingFamily) {
          const shape = getBuilding(slot.buildingFamily).footprint;
          expect(slot.footprint.length).toBe(shape.width * shape.height);
        }
        expect(slot.siteBounds.minX).toBeGreaterThanOrEqual(3);
        expect(slot.siteBounds.maxY).toBeLessThanOrEqual(height - 3);
        for (let y = slot.siteBounds.minY; y <= slot.siteBounds.maxY; y++) for (let x = slot.siteBounds.minX; x <= slot.siteBounds.maxX; x++) {
          expect(sites.has(`${x}:${y}`)).toBe(false); sites.add(`${x}:${y}`);
        }
        let previous = slot.entrance;
        for (const point of slot.accessPath) {
          expect(Math.abs(previous.x - point.x) + Math.abs(previous.y - point.y)).toBe(1);
          expect(footprints.has(`${point.x}:${point.y}`)).toBe(false); previous = point;
        }
        const end = slot.accessPath.at(-1)!;
        expect(end.x === 2 || end.y === 2 || end.x === width - 2 || end.y === height - 2).toBe(true);
        expect(slot.accessPath.length).toBeLessThanOrEqual(20);
      }
      // Independent reverse-distance oracle: flood free corridors from ALL
      // sidewalk exits, then compare each gated entrance against the optimum.
      const distance = new Map<string, number>(); const queue: Array<{ x: number; y: number }> = [];
      const add = (x: number, y: number, value: number) => {
        const key = `${x}:${y}`;
        if (x < 2 || y < 2 || x > width - 2 || y > height - 2 || sites.has(key) || distance.has(key)) return;
        distance.set(key, value); queue.push({ x, y });
      };
      for (let x = 2; x <= width - 2; x++) { add(x, 2, 0); add(x, height - 2, 0); }
      for (let y = 2; y <= height - 2; y++) { add(2, y, 0); add(width - 2, y, 0); }
      for (let i = 0; i < queue.length; i++) {
        const { x, y } = queue[i]!; const next = distance.get(`${x}:${y}`)! + 1;
        add(x - 1, y, next); add(x + 1, y, next); add(x, y - 1, next); add(x, y + 1, next);
      }
      for (const slot of slots) {
        const gate = { x: slot.entrance.x, y: slot.entrance.y + 1 };
        const best = Math.min(...[[gate.x - 1, gate.y], [gate.x + 1, gate.y], [gate.x, gate.y - 1], [gate.x, gate.y + 1]]
          .map(([x, y]) => distance.get(`${x}:${y}`) ?? Infinity));
        expect(slot.accessPath.length).toBe(best + 2);
      }
    }
  });
  it("packs at least eight staged parcels into the first32x32 block with mixed six-cell rectangles", () => {
    const layout = compileBlockLayout(spec(1));
    const block = layout.blocks[0]!;
    const slots = blockSlots(block);
    expect(block).toMatchObject({ width: 32, height: 32 });
    expect(slots.length).toBeGreaterThanOrEqual(8);
    expect(new Set(slots.filter(s => s.kind === "BUILDING").map(s => `${s.footprintBounds.maxX - s.origin.x + 1}x${s.footprintBounds.maxY - s.origin.y + 1}`)).size)
      .toBeGreaterThanOrEqual(2);
    const occupied = new Set<string>();
    const roads = new Set(rasterizeBlockRoads(layout.roadNetwork).map(p => `${p.x}:${p.y}`));
    const footprints = new Set(slots.flatMap(s => s.footprint.map(p => `${p.x}:${p.y}`)));
    for (const slot of slots) {
      const clearance = slot.kind === "PARK" && slot.siteBounds.minX === slot.origin.x ? 0 : 1;
      expect(slot.siteBounds.minX).toBe(slot.footprintBounds.minX - clearance);
      expect(slot.siteBounds.maxY).toBe(slot.footprintBounds.maxY + clearance);
      for (let y = slot.siteBounds.minY; y <= slot.siteBounds.maxY; y++) for (let x = slot.siteBounds.minX; x <= slot.siteBounds.maxX; x++) {
        expect(occupied.has(`${x}:${y}`)).toBe(false); occupied.add(`${x}:${y}`);
        expect(roads.has(`${x}:${y}`)).toBe(false);
      }
      for (const p of slot.accessPath) { expect(footprints.has(`${p.x}:${p.y}`)).toBe(false); expect(roads.has(`${p.x}:${p.y}`)).toBe(false); }
      const last = slot.accessPath.at(-1)!;
      expect([[last.x - 1, last.y], [last.x + 1, last.y], [last.x, last.y - 1], [last.x, last.y + 1]].some(([x, y]) => roads.has(`${x}:${y}`))).toBe(true);
    }
    expect(occupied.size / ((block.width - 5) * (block.height - 5))).toBeGreaterThan(.68);
  });

  it("fills every planned building slot before expansion and selects the matching rectangular family", () => {
    const first = compileBlockLayout(spec(1));
    const planned = blockSlots(first.blocks[0]!).filter(s => s.kind === "BUILDING");
    const filled = compileBlockLayout({ ...spec(planned.length), previous: first, revision: 2 });
    expect(filled.blocks).toHaveLength(1);
    for (const placement of filled.placements) {
      expect(compactBuildingShapeFamily(placement.buildingFamily))
        .toBe(compactBuildingShapeFamily(planned.find(s => s.key === placement.slotKey)!.buildingFamily!));
    }
    const next = compileBlockLayout({ ...spec(planned.length + 1), previous: filled, revision: 3 });
    expect(next.blocks).toHaveLength(2);
    expect(next.placements).toEqual(expect.arrayContaining(filled.placements));
  });

  it("reserves education for the ninth task without creating a phantom task or future block", () => {
    const eight = compileBlockLayout(spec(8));
    expect(eight.placements).toHaveLength(8);
    const occupied = new Set(eight.placements.map(p => `${p.blockId}:${p.slotKey}`));
    const plannedRoles = eight.blocks.flatMap(b => blockSlots(b).filter(s => !occupied.has(`${b.id}:${s.key}`) && s.serviceRole));
    expect(plannedRoles.map(s => s.serviceRole)).toEqual(["EDUCATION"]);
    const nine = compileBlockLayout({ ...spec(9), previous: eight, revision: 2 });
    expect(nine.placements.find(p => p.taskId === "task-9")?.serviceRole).toBe("EDUCATION");
    expect(nine.placements).toHaveLength(9);
    for (const old of eight.blocks) expect(nine.blocks.find(b => b.id === old.id)?.origin).toEqual(old.origin);
  });

  it("preserves infrastructure ordinals and never creates a building just to hold a future reservation", () => {
    for (let seed = 1; seed < 9; seed++) {
      const input = { ...spec(20), seed };
      const layout = compileBlockLayout(input);
      for (const [n, role] of [[9, "EDUCATION"], [12, "MEDICAL"], [16, "FIRE"], [20, "POLICE"]] as const) {
        expect(layout.placements.find(p => p.taskId === `task-${n}`)?.serviceRole).toBe(role);
      }
      expect(layout.placements).toHaveLength(20);
      expect(layout.blocks.every(b => layout.placements.some(p => p.blockId === b.id))).toBe(true);
      const replay = compileBlockLayout({ ...input, previous: layout, revision: 2 });
      expect(replay.placements).toEqual(layout.placements);
      expect(replay.blocks).toEqual(layout.blocks);
    }
  });

  it("reserves an airport only after the third nonempty district and railway after six nonempty blocks", () => {
    const input = spec(1);
    input.districts.push({ id: "second", archetype: "MIXED_URBAN", sequence: 1, tasks: [task(101)] });
    input.districts.push({ id: "third", archetype: "MIXED_URBAN", sequence: 2, tasks: [] });
    const two = compileBlockLayout(input);
    expect(two.blocks.flatMap(blockSlots).some(s => s.serviceRole === "AIRPORT")).toBe(false);
    input.districts[2]!.tasks.push(task(201));
    const three = compileBlockLayout({ ...input, previous: two, revision: 2 });
    expect(three.placements).toHaveLength(3);
    expect(three.blocks.flatMap(blockSlots).filter(s => s.serviceRole === "AIRPORT")).toHaveLength(1);
    input.districts[2]!.tasks.push(task(202));
    const four = compileBlockLayout({ ...input, previous: three, revision: 3 });
    expect(four.placements.find(p => p.taskId === "task-202")?.serviceRole).toBe("AIRPORT");
    const large = compileBlockLayout(spec(60));
    expect(large.blocks.length).toBeGreaterThanOrEqual(6);
    expect(large.blocks.flatMap(blockSlots).filter(s => s.serviceRole === "RAILWAY")).toHaveLength(1);
    expect(large.placements).toHaveLength(60);
  });

  it("reserves shops at two and four nonempty district blocks without inventing tasks or blocks", () => {
    const input = spec(1);
    let layout = compileBlockLayout(input);
    const shops = () => layout.blocks.flatMap(block => blockSlots(block)
      .filter(slot => slot.serviceRole === "SHOP")
      .map(slot => ({ blockId: block.id, slotKey: slot.key })));
    const append = (visualKind: "BUILDING" | "WATER" | "PARKING") => {
      const previous = layout;
      const number = input.districts[0]!.tasks.length + 1;
      input.districts[0]!.tasks.push({ ...task(number), visualKind });
      layout = compileBlockLayout({ ...input, previous, revision: number });
      expect(layout.placements.map(placement => placement.taskId).sort())
        .toEqual(input.districts[0]!.tasks.map(item => item.id).sort());
      expect(layout.blocks.every(block => layout.placements.some(placement => placement.blockId === block.id))).toBe(true);
      expect(layout.placements).toEqual(expect.arrayContaining(previous.placements));
      for (const block of previous.blocks) expect(layout.blocks.find(candidate => candidate.id === block.id)?.origin).toEqual(block.origin);
    };

    expect(layout.blocks).toHaveLength(1);
    expect(layout.placements).toHaveLength(1);
    expect(shops()).toEqual([]);
    // Typed one-slot water/parking parcels open real nonempty blocks while
    // keeping the building count below the competing education threshold.
    append("WATER");
    expect(layout.blocks).toHaveLength(2);
    expect(shops()).toHaveLength(1);
    expect(layout.placements.some(placement => placement.serviceRole === "SHOP")).toBe(false);
    append("BUILDING");
    expect(layout.blocks).toHaveLength(2);
    expect(layout.placements.find(placement => placement.taskId === "task-3")).toMatchObject({ ...shops()[0], serviceRole: "SHOP" });

    append("PARKING");
    expect(layout.blocks).toHaveLength(3);
    expect(shops()).toHaveLength(1);
    append("WATER");
    expect(layout.blocks).toHaveLength(4);
    expect(shops()).toHaveLength(2);
    expect(layout.placements.filter(placement => placement.serviceRole === "SHOP")).toHaveLength(1);
    const occupied = new Set(layout.placements.map(placement => `${placement.blockId}:${placement.slotKey}`));
    const pendingShop = shops().find(slot => !occupied.has(`${slot.blockId}:${slot.slotKey}`))!;
    expect(pendingShop).toBeDefined();
    append("BUILDING");
    expect(layout.blocks).toHaveLength(4);
    expect(layout.placements).toHaveLength(6);
    expect(layout.placements.find(placement => placement.taskId === "task-6")).toMatchObject({ ...pendingShop, serviceRole: "SHOP" });
    expect(shops()).toHaveLength(2);
  });

  it("replays interleaved task numbers globally without moving stable railway or shop roles between tasks", () => {
    const input = spec(0); input.seed = 9;
    input.districts = [0, 1, 2].map(sequence => ({ id: `district-${sequence}`, archetype: "MIXED_URBAN", sequence, tasks: [] }));
    let live = compileBlockLayout(input);
    for (let n = 1; n <= 90; n++) {
      input.districts[(n - 1) % 3]!.tasks.push(task(n));
      live = compileBlockLayout({ ...input, previous: live, revision: n + 1 });
    }
    expect(live.placements.filter(p => p.serviceRole === "RAILWAY")).toHaveLength(1);
    expect(live.placements.filter(p => p.serviceRole === "AIRPORT")).toHaveLength(1);
    const rebuilt = compileBlockLayout({ ...input, revision: 92 });
    expect(rebuilt.placements).toEqual(live.placements);
    expect(rebuilt.blocks).toEqual(live.blocks);
    expect(rebuilt.roadNetwork).toEqual(live.roadNetwork);
  });

  it("assigns automatic tasks to residual parks before opening the next block", () => {
    const input = spec(1); input.seed = 9;
    input.districts[0]!.tasks[0]!.autoVisualKind = true;
    const first = compileBlockLayout(input);
    const slots = blockSlots(first.blocks[0]!);
    expect(slots.some(s => s.kind === "PARK")).toBe(true);
    input.districts[0]!.tasks = Array.from({ length: slots.length }, (_, i) => ({ ...task(i + 1), autoVisualKind: true }));
    const filled = compileBlockLayout({ ...input, previous: first, revision: 2 });
    expect(filled.blocks).toHaveLength(1);
    expect(filled.placements.map(p => p.slotKey).sort()).toEqual(slots.map(s => s.key).sort());
    input.districts[0]!.tasks.push({ ...task(slots.length + 1), autoVisualKind: true });
    const grown = compileBlockLayout({ ...input, previous: filled, revision: 3 });
    expect(grown.blocks).toHaveLength(2);
    expect(grown.placements).toEqual(expect.arrayContaining(filled.placements));
  });

  it("honors an explicit rectangular family without silently returning another family", () => {
    const input = spec(1);
    input.districts[0]!.tasks[0]!.requestedFamily = "compact-row-v1";
    const first = compileBlockLayout(input);
    expect(first.placements[0]!.buildingFamily).toBe("compact-row-v1");
    expect(blockSlots(first.blocks[0]!)[0]!.footprint).toHaveLength(18);
    input.districts[0]!.tasks.push({ ...task(2), requestedFamily: "compact-wide-v1" });
    const next = compileBlockLayout({ ...input, previous: first, revision: 2 });
    expect(next.placements.find(p => p.taskId === "task-2")!.buildingFamily).toBe("compact-wide-v1");
    expect(next.placements).toEqual(expect.arrayContaining(first.placements));
  });

  it("rejects an explicit family that would bypass a stable mandatory infrastructure reservation", () => {
    const first = compileBlockLayout(spec(8));
    const reserved = first.blocks.flatMap(block => blockSlots(block).map(slot => ({ block, slot })))
      .find(({ slot }) => slot.serviceRole === "EDUCATION")!;
    const incompatible = ["compact-apartment-v1", "compact-row-v1", "compact-wide-v1"]
      .find(family => getBuilding(family).footprint.width * getBuilding(family).footprint.height !== reserved.slot.footprint.length)!;
    expect(incompatible).toBeDefined();
    const input = spec(9); input.districts[0]!.tasks[8]!.requestedFamily = incompatible;
    expect(() => compileBlockLayout({ ...input, previous: first, revision: 2 })).toThrow(BlockPlacementError);
    const ninth = compileBlockLayout({ ...spec(9), previous: first, revision: 2 });
    const placement = ninth.placements.find(p => p.taskId === "task-9")!;
    expect(placement).toMatchObject({ blockId: reserved.block.id, slotKey: reserved.slot.key, serviceRole: "EDUCATION" });
    const retained = blockSlots(ninth.blocks.find(block => block.id === reserved.block.id)!).find(slot => slot.key === reserved.slot.key)!;
    expect(retained.footprint).toEqual(reserved.slot.footprint);
    expect(placement.buildingFamily).toBe(retained.buildingFamily);
  });

  it("prefers an available adjacent sprint frontier while keeping physical blocks disjoint", () => {
    const input = spec(8);
    input.districts.push({ id: "second", archetype: "PRODUCTION", sequence: 1, tasks: Array.from({ length: 8 }, (_, i) => task(i + 101)) });
    input.districts.push({ id: "third", archetype: "LOWRISE", sequence: 2, tasks: Array.from({ length: 8 }, (_, i) => task(i + 201)) });
    const first = compileBlockLayout(input);
    input.districts[0]!.tasks.push(...Array.from({ length: 32 }, (_, i) => task(i + 9)));
    const grown = compileBlockLayout({ ...input, previous: first, revision: 2 });
    // Sprint AABBs are navigation envelopes and may overlap. Actual occupied
    // rectangles may not, including when a new block wraps around a neighbour.
    for (let a = 0; a < grown.blocks.length; a++) for (let b = a + 1; b < grown.blocks.length; b++) {
      const left = grown.blocks[a]!; const right = grown.blocks[b]!;
      expect(left.origin.x < right.origin.x + right.width && left.origin.x + left.width > right.origin.x
        && left.origin.y < right.origin.y + right.height && left.origin.y + left.height > right.origin.y).toBe(false);
    }
    for (const district of grown.districtLayouts) {
      const owned = grown.blocks.filter(b => b.districtLayoutId === district.id);
      const reached = new Set([owned[0]!.id]);
      for (let pass = 0; pass < owned.length; pass++) for (const a of owned) if (reached.has(a.id)) for (const b of owned) {
        const vertical = (a.origin.x + a.width === b.origin.x || b.origin.x + b.width === a.origin.x)
          && a.origin.y < b.origin.y + b.height && a.origin.y + a.height > b.origin.y;
        const horizontal = (a.origin.y + a.height === b.origin.y || b.origin.y + b.height === a.origin.y)
          && a.origin.x < b.origin.x + b.width && a.origin.x + a.width > b.origin.x;
        if (vertical || horizontal) reached.add(b.id);
      }
      expect(reached.size).toBe(owned.length);
    }
  });
});
