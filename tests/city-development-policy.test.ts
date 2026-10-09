import { expect, it } from "vitest";
import { infrastructureMilestones, nextInfrastructure } from "../src/shared/city-development-policy";
const counts = { districtId: "d", buildings: 0, districtBlocks: 0, cityBlocks: 0, cityDistricts: 0 };
it("preserves allocation thresholds, priorities and durable trigger identities", () => {
  expect(nextInfrastructure(counts, new Set())).toBeUndefined();
  for (const [buildings, role] of [[8,"EDUCATION"],[11,"MEDICAL"],[15,"FIRE"],[19,"POLICE"]] as const) {
    const before = infrastructureMilestones({ ...counts, buildings: buildings-1 }).find(m=>m.role===role)!;
    const at = infrastructureMilestones({ ...counts, buildings }).find(m=>m.role===role)!;
    expect(before.eligible).toBe(false); expect(at.eligible).toBe(true);
  }
  const ready = { ...counts, buildings: 20, districtBlocks: 6, cityBlocks: 18, cityDistricts: 3 };
  const used = new Set<string>();
  const roles: string[] = [];
  for (let m=nextInfrastructure(ready,used);m;m=nextInfrastructure(ready,used)) { roles.push(m.role);used.add(m.id); }
  expect(roles).toEqual(["EDUCATION","MEDICAL","FIRE","POLICE","RAILWAY","AIRPORT","CIVIC","SHOP","SHOP","SHOP"]);
  expect(used.has("city:AIRPORT:3")).toBe(true);
});

it("opens the airport in a large single-district city without changing its durable trigger", () => {
  const airport = (cityBlocks: number, cityDistricts: number) => infrastructureMilestones({ ...counts, cityBlocks, cityDistricts }).find(m => m.role === "AIRPORT")!;
  expect(airport(11, 1).eligible).toBe(false);
  expect(airport(12, 1)).toMatchObject({ id: "city:AIRPORT:3", eligible: true, count: 12, required: 12, unit: "CITY_BLOCKS" });
  expect(airport(3, 3).eligible).toBe(true);
  expect(airport(12, 0).eligible).toBe(true);
  const otherTriggers = new Set(infrastructureMilestones({ ...counts, cityBlocks: 12, buildings: 20 }).filter(m => m.role !== "AIRPORT").map(m => m.id));
  expect(nextInfrastructure({ ...counts, cityBlocks: 12, buildings: 20 }, otherTriggers)?.role).toBe("AIRPORT");
  expect(nextInfrastructure({ ...counts, cityBlocks: 12, buildings: 20 }, new Set([...otherTriggers, "city:AIRPORT:3"]))?.role).not.toBe("AIRPORT");
});
