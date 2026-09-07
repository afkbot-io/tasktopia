import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUILDING_CATALOG,
  PROP_CATALOG,
  REGISTERED_BUILDING_RULES,
  TASK_BUILDING_CATALOG,
  gameAssetUrl,
  illuminatedPropKey,
  taskBuildingPlatform,
} from "../src/shared/catalog";
import { MICRO_ANIMAL_SPECIES, MICRO_CAR_VARIANTS, MICRO_DIRECTIONS, microAmbientSprite } from "../src/shared/micro-ambient";
import authoredCatalog from "../assets/pixel-city-pack/catalog/buildings.json";
import { compactBuildingShapeFamily, STRUCTURAL_BUILDING_FAMILIES_V2 } from "../src/shared/compact-building-families";

const assetDiskPath = (url: string) => resolve(
  "public",
  new URL(url, "http://tasktopia.local").pathname
    .replace(/\/game-assets\/v5\/revisions\/[a-f0-9]{16}\//, "/game-assets/v5/")
    .slice(1),
);

describe("active building catalog", () => {
  it("exposes reviewed compact geometry and the independent fire family without stretching", () => {
    expect(BUILDING_CATALOG.map((entry) => entry.key)).toEqual(authoredCatalog.buildings.map(entry => entry.key).sort());
    expect(TASK_BUILDING_CATALOG).toEqual(BUILDING_CATALOG);
    const entry = TASK_BUILDING_CATALOG.find(entry => entry.key === "compact-apartment-v1")!;
    expect(entry.footprint).toEqual({ width: 6, height: 6 });
    expect(entry.spriteSize).toEqual({ width: 48, height: 48 });
    expect(entry.estimates).toEqual([1, 2, 3, 6]);
    expect(taskBuildingPlatform(entry)).toBe("STONE");
    expect(TASK_BUILDING_CATALOG.filter(entry => STRUCTURAL_BUILDING_FAMILIES_V2.some(key => key === entry.key)).map(({ footprint, spriteSize, anchor }) => ({ footprint, spriteSize, anchor }))).toEqual([
      { footprint: { width: 6, height: 6 }, spriteSize: { width: 48, height: 48 }, anchor: { x: 24, y: 48 } },
      { footprint: { width: 6, height: 3 }, spriteSize: { width: 48, height: 24 }, anchor: { x: 24, y: 24 } },
      { footprint: { width: 6, height: 4 }, spriteSize: { width: 48, height: 32 }, anchor: { x: 24, y: 32 } },
    ]);
  });

  it("content-addresses every game asset URL for immutable CDN caching", () => {
    expect(gameAssetUrl("atlas/road-v2/road.png")).toMatch(/^\/game-assets\/v5\/revisions\/[a-f0-9]{16}\/atlas\/road-v2\/road\.png$/);
    expect(gameAssetUrl("/game-assets/v5/props/gazebo.png")).toMatch(/^\/game-assets\/v5\/revisions\/[a-f0-9]{16}\/props\/gazebo\.png$/);
    const versioned = gameAssetUrl("atlas/road-v2/road.png");
    expect(gameAssetUrl(versioned)).toBe(versioned);
  });
  it("publishes valid compact building files and placement rules", () => {
    expect(BUILDING_CATALOG).toHaveLength(authoredCatalog.buildings.length);
    expect(new Set(BUILDING_CATALOG.map((entry) => entry.key)).size).toBe(BUILDING_CATALOG.length);
    expect(BUILDING_CATALOG.find(entry => entry.key === "compact-apartment-v1")?.category).toBe("HOUSE");
    for (const entry of BUILDING_CATALOG) {
      expect(compactBuildingShapeFamily(entry.key), entry.key).toBeDefined();
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

  it("provides geometry-identical illuminated variants for every lamp family", () => {
    for (const key of ["streetlamp", "streetlamp-modern", "streetlamp-double", "streetlamp-vintage", "streetlamp-solar", "streetlamp-industrial", "streetlamp-festive", "park-lamp"]) {
      const litKey = illuminatedPropKey(key);
      expect(litKey, key).not.toBe(key);
      expect(PROP_CATALOG[litKey], litKey).toMatchObject({
        size: PROP_CATALOG[key]!.size,
        footprint: PROP_CATALOG[key]!.footprint,
        anchor: PROP_CATALOG[key]!.anchor,
      });
    }
    expect(illuminatedPropKey("trash-bin")).toBe("trash-bin");
  });

  it("registers one canonical 16px paired-stop contract and no legacy variants", () => {
    for (const axis of ["horizontal", "vertical"] as const) {
      expect(PROP_CATALOG[`bus-stop-${axis}`]).toMatchObject({ size: { width: 16, height: 16 }, footprint: { width: 2, height: 2 } });
    }
    for (const obsolete of ["bus-stop-modern-horizontal", "bus-stop-modern-vertical", "bus-stop-green-horizontal", "bus-stop-green-vertical"]) {
      expect(PROP_CATALOG[obsolete]).toBeUndefined();
    }
  });

  it("uses native directional micro cars without a retired oversized bus fallback", () => {
    for (const heading of ["horizontal", "vertical", "north", "south"]) {
      expect(PROP_CATALOG[`city-bus-${heading}`]).toBeUndefined();
    }
    for (const variant of MICRO_CAR_VARIANTS) for (const direction of MICRO_DIRECTIONS) {
      const sprite = microAmbientSprite("car", variant, direction);
      expect(sprite).toMatchObject({ width: 8, height: 8, anchor: { x: 4, y: 4 }, direction, frameCount: 1 });
      expect(existsSync(assetDiskPath(sprite.url))).toBe(true);
    }
  });

  it("registers directional micro aircraft and one static native pose per animal", () => {
    for (const direction of MICRO_DIRECTIONS) {
      const sprite = microAmbientSprite("aircraft", "regional", direction);
      expect(sprite).toMatchObject({ width: 16, height: 16, anchor: { x: 8, y: 8 }, direction, frameCount: 1 });
      expect(existsSync(assetDiskPath(sprite.url))).toBe(true);
    }
    for (const species of MICRO_ANIMAL_SPECIES) {
      const sprite = microAmbientSprite("animal", species);
      expect(sprite).toMatchObject({ width: 8, height: 8, anchor: { x: 4, y: 4 }, direction: "static", frameCount: 1 });
      expect(existsSync(assetDiskPath(sprite.url))).toBe(true);
      for (const direction of MICRO_DIRECTIONS) {
        expect(microAmbientSprite("animal", species, direction)).toBe(sprite);
        for (const frame of ["a", "b", "c"]) expect(PROP_CATALOG[`animal-${species}-${direction}-${frame}`]).toBeUndefined();
      }
    }
  });

  it("keeps retired incident PNGs and oversized engines out of the active catalog", () => {
    expect(Object.keys(PROP_CATALOG).filter(key => key.startsWith("fire-engine-"))).toEqual([]);
    expect(Object.keys(PROP_CATALOG).filter(key => /^incident-(flame|smoke)-/.test(key))).toEqual([]);
  });

  it("does not expose retired moving people through the static prop catalog", () => {
    expect(Object.keys(PROP_CATALOG).filter((key) => /^(walker|resident|fisher)-/.test(key))).toEqual([]);
    expect(PROP_CATALOG["boat-horizontal-a"]).toMatchObject({ size: { width: 24, height: 8 }, footprint: { width: 3, height: 1 } });
    expect(PROP_CATALOG["boat-vertical-a"]).toMatchObject({ size: { width: 8, height: 24 }, footprint: { width: 1, height: 3 } });
  });

  it("does not expose old rider gait frames or oversized buses", () => {
    expect(Object.keys(PROP_CATALOG).filter((key) => /^(cyclist|scooter|city-bus)-/.test(key))).toEqual([]);
  });
});
