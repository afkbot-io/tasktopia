import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import { BlockPlacementError, compileBlockLayout, type BlockLayoutCompilerInput } from "../src/server/world/block-layout-compiler";
import type { BlockWorldBounds, CompiledBlockLayoutV1 } from "../src/shared/block-world";
import { blockSlots } from "../src/shared/block-templates";
import { isBuildableTerrain, terrainAt } from "../src/shared/world-terrain";
import { auditBlockLayout } from "../src/server/world/world-audit";
import replayB from "./fixtures/sprint-layout-b.json";
import replayC from "./fixtures/sprint-layout-c.json";

function preserveOldPlan(previous: CompiledBlockLayoutV1, next: CompiledBlockLayoutV1) {
  const placements = new Map(next.placements.map(placement => [placement.taskId, placement]));
  const blocks = new Map(next.blocks.map(block => [block.id, block]));
  const segments = new Map(next.roadNetwork.segments.map(segment => [segment.id, segment]));
  for (const placement of previous.placements) assert.deepEqual(placements.get(placement.taskId), placement);
  for (const block of previous.blocks) {
    const current = blocks.get(block.id)!;
    assert.ok(current);
    for (const field of ["id", "districtLayoutId", "sequence", "origin", "width", "height", "seed", "templateKey", "templateVersion", "variant"] as const) {
      assert.deepEqual(current[field], block[field], `Stable block ${block.id}/${field}`);
    }
    // Newly reserved free sites may change summary/role metadata, but no
    // existing authored family or physical slot can be repacked.
    const slots = new Map(blockSlots(current).map(slot => [slot.key, slot]));
    for (const slot of blockSlots(block)) {
      const { serviceRole: _oldRole, buildingFamily: _oldFamily, ...geometry } = slot;
      const { serviceRole: _newRole, buildingFamily: _newFamily, ...currentGeometry } = slots.get(slot.key)!;
      void _oldRole; void _newRole; void _oldFamily; void _newFamily;
      assert.deepEqual(currentGeometry, geometry);
    }
  }
  for (const segment of previous.roadNetwork.segments) assert.deepEqual(segments.get(segment.id), segment);
  assert.deepEqual(next.siteMarkers, previous.siteMarkers);
}

function terrainGuard(seed: number, excluded: BlockWorldBounds[] = []) {
  const terrain = new Map<string, boolean>();
  const dry = (point: { x: number; y: number }) => {
    const key = `${point.x}:${point.y}`;
    if (!terrain.has(key)) terrain.set(key, isBuildableTerrain(terrainAt(seed, point.x, point.y).terrain));
    return terrain.get(key)!;
  };
  const canPlaceBlock = (bounds: BlockWorldBounds) => {
    if (excluded.some(other => bounds.minX <= other.maxX && bounds.maxX >= other.minX
      && bounds.minY <= other.maxY && bounds.maxY >= other.minY)) return false;
    for (let y = bounds.minY; y <= bounds.maxY; y++) for (let x = bounds.minX; x <= bounds.maxX; x++) {
      if (!dry({ x, y })) return false;
    }
    return true;
  };
  return { dry, canPlaceBlock };
}

describe("append-only sprint growth on the connected city frontier", () => {
  it.each([
    { name: "B: 20 sprints / task 221", replay: replayB, districtCount: 20, taskCount: 220 },
    { name: "C: sixth-sprint city / task 967", replay: replayC, districtCount: 6, taskCount: 66 },
  ])("grows the enclosed original sprint without moving or reassigning its old parcels ($name)", ({ replay, districtCount, taskCount }) => {
    const input = structuredClone(replay.input) as BlockLayoutCompilerInput;
    const previous = input.previous!;
    const snapshot = structuredClone(previous);
    expect(input.districts).toHaveLength(districtCount);
    expect(previous.placements).toHaveLength(taskCount);
    expect(previous.blocks).toHaveLength(districtCount);
    const firstSprint = [...input.districts].sort((a, b) => a.sequence - b.sequence)[0]!;
    firstSprint.tasks.push({
      id: `${replay.fixture}-next-task`, taskNumber: replay.nextTaskNumber,
      buildingFamily: firstSprint.tasks[0]!.buildingFamily, facadeVariant: "south",
      visualKind: "BUILDING", autoVisualKind: true, constructionStage: 1,
    });

    // This is an independent physical-space witness, not the allocator's
    // district-AABB test: a same-size rectangle can share the easternmost
    // city street without intersecting any existing block footprint.
    const easternmost = [...previous.blocks].sort((a, b) => b.origin.x + b.width - a.origin.x - a.width)[0]!;
    const free = { x: easternmost.origin.x + easternmost.width, y: easternmost.origin.y,
      width: easternmost.width, height: easternmost.height };
    expect(previous.blocks.some(block => free.x < block.origin.x + block.width && free.x + free.width > block.origin.x
      && free.y < block.origin.y + block.height && free.y + free.height > block.origin.y)).toBe(false);

    const grown = compileBlockLayout({ ...input, canPlaceBlock: () => true });
    expect(grown.placements).toHaveLength(taskCount + 1);
    expect(grown.districtLayouts).toHaveLength(districtCount);
    expect(grown.placements).toEqual(expect.arrayContaining(previous.placements));
    expect(grown.roadNetwork.segments).toEqual(expect.arrayContaining(previous.roadNetwork.segments));
    for (const block of previous.blocks) {
      expect(grown.blocks.find(candidate => candidate.id === block.id)).toMatchObject({
        id: block.id, districtLayoutId: block.districtLayoutId, origin: block.origin,
        width: block.width, height: block.height, templateKey: block.templateKey, templateVersion: block.templateVersion,
      });
    }
    const placed = grown.placements.find(placement => placement.taskId === `${replay.fixture}-next-task`)!;
    const block = grown.blocks.find(candidate => candidate.id === placed.blockId)!;
    expect(block.districtLayoutId).toBe(grown.districtLayouts.find(district => district.districtId === firstSprint.id)!.id);
    expect(previous).toEqual(snapshot);
    expect(input.districts).toHaveLength(districtCount);
    expect(input.districts.reduce((count, district) => count + district.tasks.length, 0)).toBe(taskCount + 1);
    expect(input.districts.filter(district => district.tasks.some(task => task.id === `${replay.fixture}-next-task`)))
      .toEqual([firstSprint]);
  });

  it.for([
    { name: "B: 20 original sprints / 1,000 city tasks", replay: replayB, targetCount: 1000 },
    { name: "C: tenth city / 1,000 country tasks", replay: replayC, targetCount: 100 },
  ])("continues real terrain and preserved neighbouring cities through the old capacity boundary ($name)", { timeout: 90_000 }, ({ replay, targetCount }, context) => {
    const input = structuredClone(replay.input) as BlockLayoutCompilerInput;
    const initial = structuredClone(input.previous!);
    const districts = [...input.districts].sort((a, b) => a.sequence - b.sequence);
    const originalOwners = new Map(districts.flatMap(district => district.tasks.map(task => [task.id, district.id] as const)));
    const { dry, canPlaceBlock } = terrainGuard(input.seed, replay.otherCityBounds);
    let previous = initial;
    let number = replay.nextTaskNumber;
    const start = performance.now();
    while (previous.placements.length < targetCount) {
      const district = districts[(number - replay.nextTaskNumber) % districts.length]!;
      const id = `${replay.fixture}-task-${number}`;
      district.tasks.push({ id, taskNumber: number++, buildingFamily: "compact-apartment-v1", facadeVariant: "south",
        visualKind: "BUILDING", autoVisualKind: true, constructionStage: 1 });
      originalOwners.set(id, district.id);
      const next = compileBlockLayout({ ...input, previous, revision: previous.revision + 1, canPlaceBlock });
      preserveOldPlan(previous, next);
      previous = next;
    }
    const elapsedMs = performance.now() - start;
    expect(previous.placements).toHaveLength(targetCount);
    expect(previous.districtLayouts.map(district => district.districtId)).toEqual(districts.map(district => district.id));
    const byBlock = new Map(previous.blocks.map(block => [block.id, block]));
    const byLayout = new Map(previous.districtLayouts.map(district => [district.id, district]));
    for (const placement of previous.placements) {
      expect(byLayout.get(byBlock.get(placement.blockId)!.districtLayoutId)!.districtId).toBe(originalOwners.get(placement.taskId));
    }
    expect(auditBlockLayout(previous, undefined, dry)).toEqual([]);
    for (const block of previous.blocks.filter(block => !initial.blocks.some(old => old.id === block.id))) {
      expect(canPlaceBlock({ minX: block.origin.x - 2, minY: block.origin.y - 2,
        maxX: block.origin.x + block.width + 2, maxY: block.origin.y + block.height + 2 })).toBe(true);
    }
    // Same frozen layout + same durable ordered work must produce the same
    // result, whether refreshed in one command or appended task by task.
    const replayed = compileBlockLayout({ ...input, previous: initial, revision: previous.revision, canPlaceBlock });
    expect(replayed).toEqual(previous);
    expect(compileBlockLayout({ ...input, previous, revision: previous.revision, canPlaceBlock })).toEqual(previous);
    const chunks = (Math.floor(previous.bounds.maxX / 64) - Math.floor(previous.bounds.minX / 64) + 1)
      * (Math.floor(previous.bounds.maxY / 64) - Math.floor(previous.bounds.minY / 64) + 1);
    expect(chunks).toBeLessThanOrEqual(256);
    Object.assign(context.task.meta, { sprintGrowth: { fixture: replay.fixture, taskCount: targetCount, sprintCount: districts.length,
      blocks: previous.blocks.length, chunks, elapsedMs, countryTaskCount: number - 1, bounds: previous.bounds,
      preservedTasks: initial.placements.length, protectedNeighbourCities: replay.otherCityBounds.length } });
  });

  it("keeps both MOVE and RUIN parcels permanently occupied while the enclosed sprint grows", () => {
    const input = structuredClone(replayB.input) as BlockLayoutCompilerInput;
    const previous = input.previous!;
    const first = [...input.districts].sort((a, b) => a.sequence - b.sequence)[0]!;
    const retired = first.tasks.splice(0, 2);
    for (let index = 0; index < retired.length; index++) {
      const task = retired[index]!;
      const placement = previous.placements.find(candidate => candidate.taskId === task.id)!;
      previous.siteMarkers.push({ id: `permanent-${index}`, blockId: placement.blockId, slotKey: placement.slotKey,
        kind: index ? "RELOCATED" : "RUINED", assetVariant: index ? "frame" : "brick", snapshot: { taskNumber: task.taskNumber } });
      previous.placements = previous.placements.filter(candidate => candidate.taskId !== task.id);
    }
    first.tasks.push({ id: "resumed-sprint-work", taskNumber: 221, buildingFamily: "compact-apartment-v1",
      facadeVariant: "south", visualKind: "BUILDING", autoVisualKind: true, constructionStage: 1 });
    const next = compileBlockLayout(input);
    preserveOldPlan(previous, next);
    for (const marker of previous.siteMarkers) {
      expect(next.placements.some(placement => placement.blockId === marker.blockId && placement.slotKey === marker.slotKey)).toBe(false);
    }
    expect(next.placements).toHaveLength(219);
    expect(next.blocks).toHaveLength(21);
    expect(auditBlockLayout(next)).toEqual([]);
  });

  it("still rejects an inaccessible city frontier instead of jumping water or creating another sprint", () => {
    const input = structuredClone(replayB.input) as BlockLayoutCompilerInput;
    const snapshot = structuredClone(input.previous!);
    input.districts[0]!.tasks.push({ id: "blocked-work", taskNumber: 221, buildingFamily: "compact-apartment-v1",
      facadeVariant: "south", constructionStage: 1, autoVisualKind: true });
    expect(() => compileBlockLayout({ ...input, canPlaceBlock: () => false })).toThrow(BlockPlacementError);
    expect(input.previous).toEqual(snapshot);
    expect(input.districts).toHaveLength(20);
  });
});
