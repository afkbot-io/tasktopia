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
