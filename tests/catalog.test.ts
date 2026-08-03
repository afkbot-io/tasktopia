import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILDING_CATALOG, PROP_CATALOG, REGISTERED_BUILDING_RULES } from "../src/shared/catalog";

describe("building catalog V4", () => {
  it("contains a diverse, data-driven catalog with valid assets", () => {
    expect(BUILDING_CATALOG.length).toBeGreaterThanOrEqual(44);
    expect(new Set(BUILDING_CATALOG.map((entry) => entry.key)).size).toBe(BUILDING_CATALOG.length);
    expect(BUILDING_CATALOG.filter((entry) => entry.category === "HOUSE").length).toBeGreaterThanOrEqual(16);
    for (const entry of BUILDING_CATALOG) {
      expect(entry.key).toMatch(/^[a-z][a-z0-9-]+$/);
      expect(entry.estimates.length).toBeGreaterThan(0);
      expect(entry.footprint.width).toBeGreaterThan(0);
      expect(entry.footprint.height).toBeGreaterThan(0);
      expect(entry.spriteSize.width % 8).toBe(0);
      expect(entry.spriteSize.height % 8).toBe(0);
      expect(entry.stages).toHaveLength(5);
      expect(entry.entrances.length).toBeGreaterThan(0);
      for (const rule of entry.ruleIds) expect(REGISTERED_BUILDING_RULES.has(rule), `${entry.key}: ${rule}`).toBe(true);
      for (const stage of entry.stages) expect(existsSync(resolve("public", stage.replace("/game-assets/v4/", "game-assets/v4/"))), stage).toBe(true);
    }
  });

  it("offers service and commercial variants without duplicating runtime logic", () => {
    expect(BUILDING_CATALOG.filter((entry) => entry.serviceRole === "fire-service").length).toBeGreaterThanOrEqual(2);
    expect(BUILDING_CATALOG.filter((entry) => entry.serviceRole === "police-service").length).toBeGreaterThanOrEqual(2);
    expect(BUILDING_CATALOG.filter((entry) => entry.key.includes("gas-station") || entry.key.includes("service-plaza")).length).toBeGreaterThanOrEqual(3);
    expect(BUILDING_CATALOG.some((entry) => entry.key === "highrise-mixed-use-market" && entry.tags.includes("mixed-use"))).toBe(true);
  });

  it("registers grid-aligned park furniture and a multi-cell playground", () => {
    for (const key of ["bench-horizontal", "streetlamp", "trash-bin", "picnic-table", "playground-small"]) {
      const prop = PROP_CATALOG[key];
      expect(prop, key).toBeDefined();
      expect(prop!.size.width % 8, key).toBe(0);
      expect(prop!.size.height % 8, key).toBe(0);
      expect(existsSync(resolve("public", prop!.path.replace("/game-assets/v4/", "game-assets/v4/"))), key).toBe(true);
    }
    expect(PROP_CATALOG["playground-small"]?.size).toEqual({ width: 24, height: 16 });
    expect(PROP_CATALOG["playground-small"]?.footprint).toEqual({ width: 3, height: 2 });
  });
});
