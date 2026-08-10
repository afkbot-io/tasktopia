import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILDING_CATALOG, PROP_CATALOG, REGISTERED_BUILDING_RULES, gameAssetUrl } from "../src/shared/catalog";

const assetDiskPath = (url: string) => resolve("public", new URL(url, "http://tasktopia.local").pathname.slice(1));

describe("building catalog V4", () => {
  it("content-addresses every game asset URL for immutable CDN caching", () => {
    expect(gameAssetUrl("tiles/road.png")).toMatch(/^\/game-assets\/v4\/tiles\/road\.png\?v=[a-f0-9]{16}$/);
    expect(gameAssetUrl("/game-assets/v4/props/gazebo.png")).toMatch(/^\/game-assets\/v4\/props\/gazebo\.png\?v=[a-f0-9]{16}$/);
  });
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
      for (const stage of entry.stages) expect(existsSync(assetDiskPath(stage)), stage).toBe(true);
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
      expect(existsSync(assetDiskPath(prop!.path)), key).toBe(true);
    }
    expect(PROP_CATALOG["playground-small"]?.size).toEqual({ width: 24, height: 16 });
    expect(PROP_CATALOG["playground-small"]?.footprint).toEqual({ width: 3, height: 2 });
    for (const state of ["red", "green"]) {
      expect(PROP_CATALOG[`traffic-light-${state}`]).toMatchObject({
        size: { width: 8, height: 16 }, footprint: { width: 1, height: 1 }, anchor: { x: 4, y: 16 },
      });
    }
    for (const key of ["playground-slide", "playground-carousel", "playground-climbing", "playground-swing", "park-pond", "park-sculpture", "park-flower-clock", "park-bandstand"]) {
      expect(PROP_CATALOG[key], key).toBeDefined();
    }
  });

  it("registers one canonical 16px paired-stop contract and no legacy variants", () => {
    for (const axis of ["horizontal", "vertical"] as const) {
      expect(PROP_CATALOG[`bus-stop-${axis}`]).toMatchObject({ size: { width: 16, height: 16 }, footprint: { width: 2, height: 2 } });
    }
    for (const obsolete of ["bus-stop-modern-horizontal", "bus-stop-modern-vertical", "bus-stop-green-horizontal", "bus-stop-green-vertical"]) {
      expect(PROP_CATALOG[obsolete]).toBeUndefined();
    }
  });

  it("registers buses one cell longer than ordinary cars", () => {
    expect(PROP_CATALOG["city-bus-horizontal"]).toMatchObject({ size: { width: 24, height: 8 }, footprint: { width: 3, height: 1 } });
    expect(PROP_CATALOG["city-bus-north"]).toMatchObject({ size: { width: 8, height: 24 }, footprint: { width: 1, height: 3 } });
    expect(PROP_CATALOG["city-bus-south"]).toMatchObject({ size: { width: 8, height: 24 }, footprint: { width: 1, height: 3 } });
    expect(PROP_CATALOG["city-bus-vertical"]).toBeUndefined();
  });

  it("registers three crisp world-space flyby variants", () => {
    for (const key of ["airplane-small", "airplane-courier", "airplane-twin"]) {
      expect(PROP_CATALOG[key]).toMatchObject({ size: { width: 32, height: 16 }, footprint: { width: 1, height: 1 } });
      expect(existsSync(assetDiskPath(PROP_CATALOG[key]!.path))).toBe(true);
    }
    for (const species of ["fox", "deer", "rabbit", "boar"]) expect(PROP_CATALOG[`animal-${species}-east`]).toBeDefined();
  });

  it("registers crisp incident-response sprites on the same pixel grid", () => {
    expect(PROP_CATALOG["fire-engine-horizontal"]).toMatchObject({ size: { width: 24, height: 8 }, footprint: { width: 3, height: 1 } });
    for (const key of ["incident-flame-a", "incident-flame-b", "incident-smoke-a", "incident-smoke-b"]) {
      expect(PROP_CATALOG[key]?.size.width, key).toBe(8);
      expect(PROP_CATALOG[key]?.size.height % 8, key).toBe(0);
      expect(existsSync(assetDiskPath(PROP_CATALOG[key]!.path)), key).toBe(true);
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
