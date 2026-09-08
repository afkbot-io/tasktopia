import { describe, expect, it } from "vitest";
import { BlockPlacementError, compileBlockLayout, rasterizeBlockRoads, type BlockLayoutCompilerInput, type BlockLayoutTaskInput } from "../src/server/world/block-layout-compiler";
import { blockSlots } from "../src/shared/block-templates";
import { auditSemanticRoadNetwork } from "../src/shared/semantic-road";
import { isBuildableTerrain, terrainAt } from "../src/shared/world-terrain";

const task = (taskNumber: number, visualKind: BlockLayoutTaskInput["visualKind"] = "BUILDING"): BlockLayoutTaskInput => ({
  id: `task-${taskNumber}`, taskNumber, buildingFamily: "compact-apartment", facadeVariant: "south", constructionStage: 5, visualKind,
});
const input = (tasks: BlockLayoutTaskInput[]): BlockLayoutCompilerInput => ({
  countryId: "country", cityId: "city", seed: 7, revision: 1,
  districts: [{ id: "district", sequence: 0, archetype: "MIXED_URBAN", tasks }],
});

describe("incremental rectangular block world", () => {
  it("keeps automatic task number ranges in non-overlapping consecutive blocks", () => {
    const tasks = Array.from({ length: 150 }, (_, i) => ({ ...task(i + 1), autoVisualKind: true }));
    const layout = compileBlockLayout(input(tasks));
    const blocks = new Map(layout.blocks.map(b => [b.id, b.sequence]));
    const byTask = new Map(layout.placements.map(p => [p.taskId, blocks.get(p.blockId)!]));
    const sequence = tasks.map(t => byTask.get(t.id)!);
    expect(sequence).toEqual([...sequence].sort((a,b) => a-b));
  });
  it("continues forward after a task needs a dedicated public-space block", () => {
    const tasks = [task(1),task(2,"WATER"),task(3),task(4)];
    const layout = compileBlockLayout(input(tasks));
    const blocks = new Map(layout.blocks.map(b => [b.id,b.sequence]));
    const byTask = new Map(layout.placements.map(p => [p.taskId,blocks.get(p.blockId)!]));
    expect(byTask.get("task-3")).toBeGreaterThanOrEqual(byTask.get("task-2")!);
    expect(byTask.get("task-4")).toBe(byTask.get("task-3"));
  });
  it("fills compatible slots before adding a block and preserves every old position", () => {
    const first = compileBlockLayout(input([task(1), task(2)]));
    const capacity = blockSlots(first.blocks[0]!).filter(slot => slot.kind === "BUILDING").length;
    expect(capacity).toBeGreaterThanOrEqual(2);
    const filled = compileBlockLayout({ ...input(Array.from({ length: capacity }, (_, i) => task(i + 1)).reverse()), revision: 2, previous: first });
    expect(filled.blocks).toHaveLength(1);
    expect(filled.placements).toEqual(expect.arrayContaining(first.placements));
    const expanded = compileBlockLayout({ ...input(Array.from({ length: capacity + 1 }, (_, i) => task(i + 1))), revision: 3, previous: filled });
    expect(expanded.id).toBe(first.id);
    expect(expanded.blocks).toHaveLength(2);
    expect(expanded.blocks[0]).toEqual(filled.blocks[0]);
    expect(expanded.placements.filter((p) => p.taskId !== `task-${capacity + 1}`)).toEqual(filled.placements);
    expect(expanded.roadNetwork.segments).toEqual(expect.arrayContaining(first.roadNetwork.segments));
  });

  it("keeps earlier placements even when a lower-numbered imported task arrives", () => {
    const first = compileBlockLayout(input([task(5), task(10)]));
    const expanded = compileBlockLayout({ ...input([task(1), task(5), task(10)]), revision: 2, previous: first });
    for (const placement of first.placements) expect(expanded.placements).toContainEqual(placement);
  });

  it("plans typed park slots without inventing tasks and admits explicit water and parking tasks", () => {
    const first = compileBlockLayout(input([task(1)]));
    expect(first.placements).toHaveLength(1);
    expect(blockSlots(first.blocks[0]!).length).toBeGreaterThanOrEqual(8);
    const grown = compileBlockLayout({ ...input([task(1), task(2, "PARK"), task(3, "WATER"), task(4, "PARKING")]), previous: first, revision: 2 });
    const slots = new Map(grown.blocks.flatMap((b) => blockSlots(b).map((s) => [`${b.id}:${s.key}`, s] as const)));
    for (const placement of grown.placements) {
      expect(slots.get(`${placement.blockId}:${placement.slotKey}`)?.kind).toBe(
        placement.taskId === "task-1" ? "BUILDING" : placement.taskId === "task-2" ? "PARK" : placement.taskId === "task-3" ? "WATER" : "PARKING");
    }
  });

  it("extends multiple districts without overlap or disconnected road loops", () => {
    const first = input(Array.from({ length: 100 }, (_, i) => task(i + 1)));
    first.districts.push({ id: "district-2", sequence: 1, archetype: "PRODUCTION", tasks: Array.from({ length: 30 }, (_, i) => task(i + 101)) });
    const layout = compileBlockLayout(first);
    expect(layout.placements).toHaveLength(130);
    expect(auditSemanticRoadNetwork(layout.roadNetwork)).toBe(layout.roadNetwork);
    const modules = new Set<string>();
    for (const block of layout.blocks) for (let y = block.origin.y; y < block.origin.y + block.height; y += 16) {
      for (let x = block.origin.x; x < block.origin.x + block.width; x += 16) {
        expect(modules.has(`${x}:${y}`)).toBe(false); modules.add(`${x}:${y}`);
      }
    }
    expect(new Set(layout.blocks.map((b) => `${b.width}:${b.height}`)).size).toBeGreaterThan(1);
  });

  it("retains closed marker slots and preserves construction identity during stage changes", () => {
    const first = compileBlockLayout(input([task(1)]));
    const placement = first.placements[0]!;
    first.siteMarkers.push({ id: "ruin", blockId: placement.blockId, slotKey: placement.slotKey, kind: "RUINED", assetVariant: "ruin", snapshot: {} });
    first.placements = [];
    const next = compileBlockLayout({ ...input([{ ...task(2), constructionStage: 3 }]), previous: first, revision: 2 });
    expect(next.placements[0]!.slotKey).toBe("slot-1");
    const done = compileBlockLayout({ ...input([task(2)]), previous: next, revision: 3 });
    expect(done.placements[0]).toEqual({ ...next.placements[0], constructionStage: 5 });
  });

  it("keeps footprint, site clearance and pedestrian access clear of every road and other building", () => {
    const layout = compileBlockLayout(input(Array.from({ length: 25 }, (_, i) => task(i + 1))));
    const roads = new Set(rasterizeBlockRoads(layout.roadNetwork).map((r) => `${r.x}:${r.y}`));
    const slots = layout.blocks.flatMap(blockSlots);
    const buildings = new Set(slots.flatMap((s) => s.footprint.map((p) => `${p.x}:${p.y}`)));
    for (const slot of slots) {
      expect(slot.footprint.length).toBeGreaterThanOrEqual(slot.kind === "PARK" ? 1 : 18);
      for (let y = slot.siteBounds.minY; y <= slot.siteBounds.maxY; y += 1) for (let x = slot.siteBounds.minX; x <= slot.siteBounds.maxX; x += 1) {
        expect(roads.has(`${x}:${y}`)).toBe(false);
      }
      for (const point of slot.accessPath) {
        expect(roads.has(`${point.x}:${point.y}`)).toBe(false);
        expect(buildings.has(`${point.x}:${point.y}`)).toBe(false);
      }
      const end = slot.accessPath.at(-1)!;
      expect([[end.x - 1, end.y], [end.x + 1, end.y], [end.x, end.y - 1], [end.x, end.y + 1]]
        .some(([x, y]) => roads.has(`${x}:${y}`))).toBe(true);
    }
  });

  it("clips raster cells without changing boundary masks, including negative coordinates", () => {
    const layout = compileBlockLayout({ ...input([task(1), task(2), task(3), task(4)]), origin: { x: -32, y: -16 } });
    const bounds = { minX: -20, minY: -20, maxX: 25, maxY: 25 };
    expect(rasterizeBlockRoads(layout.roadNetwork, bounds)).toEqual(rasterizeBlockRoads(layout.roadNetwork)
      .filter((r) => r.x >= bounds.minX && r.x <= bounds.maxX && r.y >= bounds.minY && r.y <= bounds.maxY));
  });

  it("rejects occupied terrain and does not skip water to create a disconnected block", () => {
    expect(() => compileBlockLayout({ ...input([task(1)]), canPlaceBlock: (b) => b.minX >= 30 }))
      .toThrow(BlockPlacementError);
    expect(() => compileBlockLayout({ ...input([task(1)]), canPlaceBlock: () => false })).toThrow(/buildable connected/);
  });

  it("gives an empty city a valid connected street skeleton", () => {
    const layout = compileBlockLayout({ ...input([]), districts: [] });
    expect(layout.blocks).toEqual([]); expect(layout.placements).toEqual([]);
    expect(auditSemanticRoadNetwork(layout.roadNetwork)).toBe(layout.roadNetwork);
    expect(layout.bounds.maxX - layout.bounds.minX).toBeLessThan(32);
  });

  it("does not reserve buildable rectangles for empty future districts or block an existing free slot", () => {
    const spec = input([task(1)]);
    for (let d = 1; d < 10; d++) spec.districts.push({ id: `empty-${d}`, sequence: d, archetype: "MIXED_URBAN", tasks: [] });
    const canPlaceBlock = (b: { minX: number; minY: number; maxX: number; maxY: number }) =>
      b.minX >= -2 && b.minY >= -2 && b.maxX <= 34 && b.maxY <= 34;
    const first = compileBlockLayout({ ...spec, canPlaceBlock });
    const capacity = blockSlots(first.blocks[0]!).filter(slot => slot.kind === "BUILDING").length;
    spec.districts[0]!.tasks.push(...Array.from({ length: capacity - 1 }, (_, i) => task(i + 2)));
    const filled = compileBlockLayout({ ...spec, previous: first, revision: 2, canPlaceBlock });
    expect(filled.blocks).toHaveLength(1);
    expect(filled.placements).toHaveLength(capacity);
    expect(filled.districtLayouts).toHaveLength(10);
    spec.districts[0]!.tasks.push(task(capacity + 1));
    expect(() => compileBlockLayout({ ...spec, previous: filled, revision: 3, canPlaceBlock })).toThrow(BlockPlacementError);
  });

  it("fits a thousand-task district into the bounded city scene without a narrow vertical strip", () => {
    const layout = compileBlockLayout(input(Array.from({ length: 1000 }, (_, i) => task(i + 1))));
    const width = layout.bounds.maxX - layout.bounds.minX;
    const height = layout.bounds.maxY - layout.bounds.minY;
    expect(height / width).toBeLessThan(10);
    const chunks = (Math.floor(layout.bounds.maxX / 64) - Math.floor(layout.bounds.minX / 64) + 1)
      * (Math.floor(layout.bounds.maxY / 64) - Math.floor(layout.bounds.minY / 64) + 1);
    expect(chunks).toBeLessThanOrEqual(256);
  });

  it("rejects an empty-city street crossing water", () => {
    expect(() => compileBlockLayout({ ...input([]), canPlaceBlock: () => false }))
      .toThrow(/initial street/);
  });

  it("packs new districts next to existing blocks and grows around foreign parcels without moving them", () => {
    const spec = input([task(1), task(2)]);
    spec.districts.push({ id: "second", sequence: 1, archetype: "MIXED_URBAN", tasks: [task(3), task(4)] });
    spec.districts.push({ id: "third", sequence: 2, archetype: "MIXED_URBAN", tasks: [task(5), task(6)] });
    const first = compileBlockLayout({ ...spec, canPlaceBlock: () => true });
    expect(first.bounds.maxX - first.bounds.minX).toBeLessThan(112);
    const oldOrigins = new Map(first.blocks.map((b) => [b.id, b.origin]));
    spec.districts[0]!.tasks.push(...Array.from({ length: 30 }, (_, i) => task(i + 7)));
    const grown = compileBlockLayout({ ...spec, revision: 2, previous: first, canPlaceBlock: () => true });
    for (const [id, origin] of oldOrigins) expect(grown.blocks.find((b) => b.id === id)?.origin).toEqual(origin);
    const modules = new Set<string>();
    for (const b of grown.blocks) for (let y = b.origin.y; y < b.origin.y + b.height; y += 16) {
      for (let x = b.origin.x; x < b.origin.x + b.width; x += 16) {
        expect(modules.has(`${x}:${y}`)).toBe(false); modules.add(`${x}:${y}`);
      }
    }
    expect(auditSemanticRoadNetwork(grown.roadNetwork)).toBe(grown.roadNetwork);
  });

  it("refuses growth when the entire buildable city shelf is full", () => {
    const spec = { ...input([task(1, "PARK"), task(2, "PARK")]), origin: { x: 128, y: 0 } };
    spec.districts.push({ id: "right", sequence: 1, archetype: "MIXED_URBAN", tasks: [task(3), task(4), task(5)] });
    // Both sprint rectangles and their reserved street gap fill the dry shelf. A detached sprint block is
    // permitted, but only on real connected buildable land, never beyond it.
    const canPlaceBlock = (b: { minX: number; minY: number; maxX: number; maxY: number }) =>
      b.minX >= 126 && b.maxX <= 194 && b.minY >= -2 && b.maxY <= 34;
    const first = compileBlockLayout({ ...spec, canPlaceBlock });
    const right = first.blocks.find(b => b.districtLayoutId === first.districtLayouts[1]!.id)!;
    expect(right.origin).toEqual({ x: 160, y: 0 });
    spec.districts[1]!.tasks.push(...Array.from({ length: 7 }, (_, i) => task(i + 6)));
    expect(() => compileBlockLayout({ ...spec, canPlaceBlock, previous: first, revision: 2 })).toThrow(BlockPlacementError);
  });

  it("uses a smaller compatible rectangle when the preferred block shape cannot fit dry land", () => {
    const canPlaceBlock = (b: { minX: number; minY: number; maxX: number; maxY: number }) => {
      for (let y = b.minY; y <= b.maxY; y++) for (let x = b.minX; x <= b.maxX; x++) {
        if (!(x >= -2 && x <= 34 && y >= -2 && y <= 34)
          && !(x >= 30 && x <= 50 && y >= -2 && y <= 18)) return false;
      }
      return true;
    };
    const initial = compileBlockLayout({ ...input([task(1)]), canPlaceBlock });
    const capacity = blockSlots(initial.blocks[0]!).filter(slot => slot.kind === "BUILDING").length;
    const first = compileBlockLayout({ ...input(Array.from({ length: capacity }, (_, i) => task(i + 1))), previous: initial, revision: 2, canPlaceBlock });
    const next = compileBlockLayout({ ...input(Array.from({ length: capacity + 1 }, (_, i) => task(i + 1))), previous: first, revision: 3, canPlaceBlock });
    expect(next.blocks[1]!.templateKey).toBe("residential-single");
    expect(next.blocks[1]!.origin).toEqual({ x: 32, y: 0 });
    expect(next.placements).toEqual(expect.arrayContaining(first.placements));
    expect(next.roadNetwork.segments).toEqual(expect.arrayContaining(first.roadNetwork.segments));
  });

  it("grows a hundred-task coastal city across every dry frontier without moving or flooding old sites", () => {
    const spec = { ...input([]), origin: { x: 96, y: -128 }, seed: 424242 };
    const dry = new Map<string, boolean>();
    const isDry = (x: number, y: number) => {
      const key = `${x}:${y}`;
      if (!dry.has(key)) dry.set(key, isBuildableTerrain(terrainAt(spec.seed, x, y).terrain));
      return dry.get(key)!;
    };
    const canPlaceBlock = (b: { minX: number; minY: number; maxX: number; maxY: number }) => {
      for (let y = b.minY; y <= b.maxY; y++) for (let x = b.minX; x <= b.maxX; x++) if (!isDry(x, y)) return false;
      return true;
    };
    let layout = compileBlockLayout({ ...spec, canPlaceBlock });
    for (let t = 1; t <= 100; t++) {
      spec.districts[0]!.tasks.push(task(t));
      const previous = layout;
      layout = compileBlockLayout({ ...spec, previous, revision: previous.revision + 1, canPlaceBlock });
      for (const old of previous.blocks) expect(layout.blocks.find(b => b.id === old.id)?.origin).toEqual(old.origin);
      expect(layout.roadNetwork.segments).toEqual(expect.arrayContaining(previous.roadNetwork.segments));
    }
    expect(layout.placements).toHaveLength(100);
    expect(layout.blocks.some(b => b.origin.x < spec.origin.x || b.origin.y < spec.origin.y)).toBe(true);
    for (const cell of rasterizeBlockRoads(layout.roadNetwork)) expect(isDry(cell.x, cell.y)).toBe(true);
    const width = layout.bounds.maxX - layout.bounds.minX;
    const height = layout.bounds.maxY - layout.bounds.minY;
    expect(Math.max(width, height) / Math.min(width, height)).toBeLessThan(2);
  });

  it("keeps three fourteen-task districts compact and incrementally buildable on the preview terrain", () => {
    const spec = { ...input([]), origin: { x: -32, y: -128 }, seed: 987321 };
    const dry = new Map<string, boolean>();
    const canPlaceBlock = (b: { minX: number; minY: number; maxX: number; maxY: number }) => {
      for (let y = b.minY; y <= b.maxY; y++) for (let x = b.minX; x <= b.maxX; x++) {
        const key = `${x}:${y}`;
        if (!dry.has(key)) dry.set(key, isBuildableTerrain(terrainAt(spec.seed, x, y).terrain));
        if (!dry.get(key)) return false;
      }
      return true;
    };
    let layout = compileBlockLayout({ ...spec, canPlaceBlock });
    for (let d = 0; d < 3; d++) {
      if (d > 0) spec.districts.push({ id: `district-${d}`, sequence: d, archetype: "MIXED_URBAN", tasks: [] });
      for (let t = 0; t < 14; t++) {
        spec.districts[d]!.tasks.push(task(d * 14 + t + 1));
        const next = compileBlockLayout({ ...spec, previous: layout, revision: layout.revision + 1, canPlaceBlock });
        for (const old of layout.blocks) expect(next.blocks.find(b => b.id === old.id)?.origin).toEqual(old.origin);
        layout = next;
      }
    }
    expect(layout.placements).toHaveLength(42);
    const width = layout.bounds.maxX - layout.bounds.minX;
    const height = layout.bounds.maxY - layout.bounds.minY;
    expect(Math.max(width, height) / Math.min(width, height)).toBeLessThan(2);
    expect(auditSemanticRoadNetwork(layout.roadNetwork)).toBe(layout.roadNetwork);
  });
});
