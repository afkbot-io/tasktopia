import { expect, it } from "vitest";
import { BUILDING_CATALOG } from "../src/shared/catalog";
import { compactBuildingServiceRole, compactServiceFamily } from "../src/shared/compact-building-families";
import { compileBlockLayout } from "../src/server/world/block-layout-compiler";

it("exposes the reviewed native port terminal as a unique coastal service", () => {
  const entry = BUILDING_CATALOG.find(item => item.key === "compact-port-v1");
  expect(entry).toMatchObject({ serviceRole: "PORT", maxPerCity: 1, footprint: { width: 6, height: 4 }, spriteSize: { width: 48, height: 32 }, anchor: { x: 24, y: 32 } });
  expect(entry!.stages).toHaveLength(5);
  expect(compactBuildingServiceRole("compact-port-v1")).toBe("PORT");
  expect(compactServiceFamily("PORT", 6, 4)).toBe("compact-port-v1");
});

it("does not place an explicitly requested port without a trusted coastal plan", () => {
  expect(() => compileBlockLayout({ countryId: "country", cityId: "city", seed: 1742, revision: 1,
    districts: [{ id: "district", archetype: "MIXED_URBAN", sequence: 0, tasks: [{
      id: "port", taskNumber: 1, buildingFamily: "compact-port-v1", requestedFamily: "compact-port-v1",
      facadeVariant: "south", constructionStage: 1,
    }] }],
  })).toThrow(/подтверждённый.*берег/);
});
