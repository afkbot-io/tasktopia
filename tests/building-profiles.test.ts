import { expect, it } from "vitest";
import { BUILDING_PROFILES, preferredProfileHomes } from "../src/shared/building-profiles";
import { BUILDING_CATALOG } from "../src/shared/catalog";
import { compileBlockLayout } from "../src/server/world/block-layout-compiler";
const tasks = Array.from({ length: 28 }, (_, i) => ({ id: `t${i}`, taskNumber: i + 1, buildingFamily: "residential", facadeVariant: "south", constructionStage: 3 as const }));
const input = { countryId: "c", cityId: "city", seed: 123, revision: 1, districts: [{ id: "d", sequence: 0, archetype: "PRIVATE", tasks }] };
it("uses only actual compatible house families and has a fallback", () => {
  for (const profile of Object.values(BUILDING_PROFILES)) for (const family of profile.homes) {
    expect(BUILDING_CATALOG.find(b => b.key === family)?.category).toBe("HOUSE");
  }
  expect(preferredProfileHomes(["compact-row-v1", "compact-glass-stair-v1"], "PRIVATE")).toEqual(["compact-row-v1"]);
  expect(preferredProfileHomes(["unlisted-compatible"], "CIVIC")).toEqual(["unlisted-compatible"]);
});
it("produces distinct deterministic profiles independent of input order", () => {
  const signatures = new Set<string>();
  for (const archetype of Object.keys(BUILDING_PROFILES)) {
    const candidate = { ...input, districts: [{ ...input.districts[0]!, archetype }] };
    const first = compileBlockLayout(candidate);
    expect(compileBlockLayout({ ...candidate, districts: [{ ...candidate.districts[0]!, tasks: [...tasks].reverse() }] })).toEqual(first);
    expect(first.blocks.every(b => b.parameters.buildingProfile === archetype && b.parameters.buildingProfileVersion === 1)).toBe(true);
    signatures.add(JSON.stringify(first.blocks.map(b => [b.parameters.sitePlan, b.parameters.slotFamilies])));
  }
  expect(signatures.size).toBe(5);
});
it("preserves old site plans and assigned families when a district changes profile and grows", () => {
  const before = compileBlockLayout(input);
  // A legacy block has no profile; its durable sites must still win.
  for (const block of before.blocks) { delete block.parameters.buildingProfile; delete block.parameters.buildingProfileVersion; }
  const snapshot = structuredClone(before);
  const after = compileBlockLayout({ ...input, revision: 2, previous: before, districts: [{ ...input.districts[0]!, archetype: "NEW_BUILD", tasks: [...tasks, ...tasks.map((t,i) => ({ ...t, id: `new${i}`, taskNumber: i + 29 }))] }] });
  for (const old of snapshot.blocks) {
    const current = after.blocks.find(b => b.id === old.id)!;
    expect(current.origin).toEqual(old.origin);
    expect(current.parameters.sitePlan).toEqual(old.parameters.sitePlan);
    expect(current.parameters.buildingProfile).toBeUndefined();
    expect(current.parameters.slotFamilies).toMatchObject(old.parameters.slotFamilies as object);
  }
  expect(after.blocks.filter(b => !snapshot.blocks.some(old => old.id === b.id)).every(b => b.parameters.buildingProfile === "NEW_BUILD")).toBe(true);
});
