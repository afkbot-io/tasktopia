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

  it("registers three crisp world-space flyby variants", () => {
    for (const key of ["airplane-small", "airplane-courier", "airplane-twin"]) {
      expect(PROP_CATALOG[key]).toMatchObject({ size: { width: 32, height: 16 }, footprint: { width: 1, height: 1 } });
      expect(existsSync(resolve("public", PROP_CATALOG[key]!.path.replace("/game-assets/v4/", "game-assets/v4/")))).toBe(true);
    }
    for (const species of ["fox", "deer", "rabbit", "boar"]) expect(PROP_CATALOG[`animal-${species}-east`]).toBeDefined();
  });

  it("registers crisp incident-response sprites on the same pixel grid", () => {
    expect(PROP_CATALOG["fire-engine-horizontal"]).toMatchObject({ size: { width: 24, height: 8 }, footprint: { width: 3, height: 1 } });
    for (const key of ["incident-flame-a", "incident-flame-b", "incident-smoke-a", "incident-smoke-b"]) {
      expect(PROP_CATALOG[key]?.size.width, key).toBe(8);
      expect(PROP_CATALOG[key]?.size.height % 8, key).toBe(0);
      expect(existsSync(resolve("public", PROP_CATALOG[key]!.path.replace("/game-assets/v4/", "game-assets/v4/"))), key).toBe(true);
    }
  });

  it("keeps every human on the walker scale and gives crewed boats a slender footprint", () => {
    const walkerSize = PROP_CATALOG["walker-south"]?.size;
    expect(walkerSize).toEqual({ width: 8, height: 8 });
    for (const key of ["fisher-north", "fisher-east", "fisher-south", "fisher-west", "resident-reader", "resident-box", "resident-sweeper", "resident-phone", "resident-worker", "resident-wave"]) {
      expect(PROP_CATALOG[key]?.size, key).toEqual(walkerSize);
      expect(PROP_CATALOG[key]?.footprint, key).toEqual({ width: 1, height: 1 });
    }
    expect(PROP_CATALOG["boat-horizontal-a"]).toMatchObject({ size: { width: 24, height: 8 }, footprint: { width: 3, height: 1 } });
    expect(PROP_CATALOG["boat-vertical-a"]).toMatchObject({ size: { width: 8, height: 24 }, footprint: { width: 1, height: 3 } });
  });
});
