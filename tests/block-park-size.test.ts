import { describe, expect, it } from "vitest";
import { compileBlockLayout, type BlockLayoutCompilerInput, type BlockLayoutTaskInput } from "../src/server/world/block-layout-compiler";
import { blockSlots, type BlockSlot } from "../src/shared/block-templates";
import type { CompiledBlockLayoutV1 } from "../src/shared/block-world";
import { auditBlockLayout } from "../src/server/world/world-audit";

const task = (number: number): BlockLayoutTaskInput => ({ id: `task-${number}`, taskNumber: number,
  buildingFamily: "compact-apartment-v1", facadeVariant: "south", constructionStage: 1, visualKind: "BUILDING" });
const park = (number: number, parkSize?: "POCKET" | "BLOCK"): BlockLayoutTaskInput & { parkSize?: "POCKET" | "BLOCK" } =>
  ({ ...task(number), visualKind: "PARK", parkSize });
const spec = (tasks: BlockLayoutTaskInput[], previous?: CompiledBlockLayoutV1): BlockLayoutCompilerInput => ({
  countryId: "country", cityId: "city", seed: 9, revision: (previous?.revision ?? 0) + 1, previous,
  districts: [{ id: "sprint", sequence: 0, archetype: "MIXED_URBAN", tasks }],
});
const geometry = ({ buildingFamily, serviceRole, kind, ...slot }: BlockSlot) => {
  void buildingFamily; void serviceRole; void kind;
  return slot;
};
const placedSlot = (layout: CompiledBlockLayoutV1, id: string) => {
  const placement = layout.placements.find(candidate => candidate.taskId === id)!;
  const block = layout.blocks.find(candidate => candidate.id === placement.blockId)!;
  return { placement, block, slot: blockSlots(block).find(candidate => candidate.key === placement.slotKey)! };
};

describe("size-aware task-backed parks without repacking existing parcels", () => {
  it("fills an existing compatible PARK before taking an unused building parcel", () => {
    const before = compileBlockLayout(spec([task(1)]));
    const existing = blockSlots(before.blocks[0]!).find(slot => slot.kind === "PARK")!;
    expect(existing).toBeDefined();
    const next = compileBlockLayout(spec([task(1), park(2, "POCKET")], before));
    expect(next.blocks).toHaveLength(1);
    expect(placedSlot(next, "task-2").slot).toEqual(existing);
    expect(next.placements).toEqual(expect.arrayContaining(before.placements));
  });

  it("persists a compact PARK in a free BUILDING slot once residual parks are occupied", () => {
    const initial = compileBlockLayout(spec([task(1)]));
    const parkCount = blockSlots(initial.blocks[0]!).filter(slot => slot.kind === "PARK").length;
    const tasks = [task(1), ...Array.from({ length: parkCount }, (_, index) => park(index + 2))];
    const before = compileBlockLayout(spec(tasks, initial));
    const occupied = new Set(before.placements.map(placement => placement.slotKey));
    const available = blockSlots(before.blocks[0]!).find(slot => slot.kind === "BUILDING" && !occupied.has(slot.key))!;
    const added = park(tasks.length + 1, "POCKET");
    const next = compileBlockLayout(spec([...tasks, added], before));
    const current = placedSlot(next, added.id);
    expect(next.blocks).toHaveLength(before.blocks.length);
    expect(current.slot.kind).toBe("PARK");
    expect(current.slot.buildingFamily).toBeUndefined();
    expect(current.slot.serviceRole).toBeUndefined();
    expect(current.block.parameters.slotKinds).toMatchObject({ [available.key]: "PARK" });
    expect(geometry(current.slot)).toEqual(geometry(available));
    expect(next.placements).toEqual(expect.arrayContaining(before.placements));
    expect(next.roadNetwork).toEqual(before.roadNetwork);
    const reopened = compileBlockLayout(spec([...tasks, added], structuredClone(next)));
    expect(placedSlot(reopened, added.id).slot).toEqual(current.slot);
    expect(auditBlockLayout(next)).toEqual([]);
  });

  it("never converts occupied, permanently closed or infrastructure-reserved building slots", () => {
    const before = compileBlockLayout(spec([task(1)]));
    const block = before.blocks[0]!;
    const occupied = before.placements[0]!.slotKey;
    const free = blockSlots(block).filter(slot => slot.kind === "BUILDING" && slot.key !== occupied);
    expect(free.length).toBeGreaterThanOrEqual(3);
    const reserved = free[0]!, ruined = free[1]!, target = free[2]!;
    block.parameters.slotRoles = { [reserved.key]: "EDUCATION" };
    for (const slot of [ruined, ...blockSlots(block).filter(candidate => candidate.kind === "PARK")]) {
      before.siteMarkers.push({ id: `closed-${slot.key}`, blockId: block.id, slotKey: slot.key,
        kind: "RUINED", assetVariant: "brick", snapshot: {} });
    }
    const snapshot = structuredClone(before);
    const next = compileBlockLayout(spec([task(1), park(2, "POCKET")], before));
    expect(placedSlot(next, "task-2").slot.key).toBe(target.key);
    expect(next.blocks).toHaveLength(1);
    expect(next.blocks[0]!.parameters.slotRoles).toEqual({ [reserved.key]: "EDUCATION" });
    expect(next.siteMarkers).toEqual(snapshot.siteMarkers);
    expect(before).toEqual(snapshot);
    expect(next.placements).toEqual(expect.arrayContaining(before.placements));
    expect(auditBlockLayout(next)).toEqual([]);
  });

  it("gives an explicit large park its own 17×17 or larger parcel without changing the old template", () => {
    const before = compileBlockLayout(spec([task(1)]));
    const next = compileBlockLayout(spec([task(1), park(2, "BLOCK")], before));
    const { slot, block } = placedSlot(next, "task-2");
    expect(block.templateKey).toBe("park-grand");
    expect(slot.footprintBounds.maxX - slot.footprintBounds.minX + 1).toBeGreaterThanOrEqual(17);
    expect(slot.footprintBounds.maxY - slot.footprintBounds.minY + 1).toBeGreaterThanOrEqual(17);
    expect(next.blocks).toHaveLength(2);
    const old = before.blocks[0]!;
    const retained = next.blocks.find(candidate => candidate.id === old.id)!;
    expect(retained).toMatchObject({ origin: old.origin, width: old.width, height: old.height,
      templateKey: old.templateKey, templateVersion: old.templateVersion, districtLayoutId: old.districtLayoutId });
    expect(blockSlots(retained).map(geometry)).toEqual(blockSlots(old).map(geometry));
    expect(next.placements).toEqual(expect.arrayContaining(before.placements));
    expect(next.roadNetwork.segments).toEqual(expect.arrayContaining(before.roadNetwork.segments));
    expect(auditBlockLayout(next)).toEqual([]);
  });

  it("opens a normal planned block for the first pocket task without assigning it a whole park court", () => {
    const next = compileBlockLayout(spec([park(1, "POCKET")]));
    const { slot } = placedSlot(next, "task-1");
    expect(next.placements).toHaveLength(1);
    expect(next.blocks).toHaveLength(1);
    expect(slot.kind).toBe("PARK");
    expect(slot.footprint.length).toBeGreaterThanOrEqual(18);
    expect(slot.footprint.length).toBeLessThanOrEqual(36);
    expect(auditBlockLayout(next)).toEqual([]);
  });

  it("rejects corrupt kind overrides instead of repainting another service or a differently shaped slot", () => {
    const block = compileBlockLayout(spec([task(1)])).blocks[0]!;
    const free = blockSlots(block).find(slot => slot.kind === "BUILDING" && slot.key !== "slot-0")!;
    for (const parameters of [
      { slotKinds: { "slot-999": "PARK" } },
      { slotKinds: { [free.key]: "WATER" } },
      { slotKinds: { [free.key]: "PARK" }, slotRoles: { [free.key]: "FIRE" } },
      { slotKinds: { [free.key]: "PARK" }, slotFamilies: { [free.key]: free.buildingFamily! } },
    ]) expect(() => blockSlots({ ...block, parameters: { ...block.parameters, ...parameters } })).toThrow(/kind|slot|reservation|family/i);
  });
});
