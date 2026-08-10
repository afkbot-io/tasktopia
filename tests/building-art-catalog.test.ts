import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import catalog from "../assets/pixel-city-pack-v4/catalog/buildings.json";
import manifest from "../assets/pixel-city-pack-v4/manifest.json";

type CatalogBuilding = {
  key: string;
  label: string;
  category: string;
  rarity: string;
  spriteSize: number[];
  footprintCells: number[];
  anchorPx: number[];
  platform: string;
  estimates: number[];
  tags: string[];
  ruleIds: string[];
  entrances: Array<{ side: string; offset: number }>;
  maxPerCity: number | null;
  maxPerDistrict: number | null;
  serviceRole: string | null;
  sheet: string | null;
  sheetSha256: string | null;
  reviewed: boolean;
};

type RuntimeBuilding = Omit<CatalogBuilding, "key" | "sheet" | "sheetSha256" | "reviewed"> & {
  stages: string[];
};

const referenceRoot = resolve("assets/pixel-city-pack-v4/reference");
const manifestBuildings = manifest.buildings as Record<string, RuntimeBuilding>;
const catalogBuildings = catalog.buildings as CatalogBuilding[];

const frozenFields = [
  "label",
  "category",
  "rarity",
  "spriteSize",
  "footprintCells",
  "anchorPx",
  "platform",
  "estimates",
  "tags",
  "ruleIds",
  "entrances",
  "maxPerCity",
  "maxPerDistrict",
  "serviceRole",
] as const;

describe("unified building art catalog", () => {
  it("tracks every runtime building key exactly once", () => {
    const catalogKeys = catalogBuildings.map((building) => building.key);
    expect(catalogKeys).toHaveLength(193);
    expect(new Set(catalogKeys).size).toBe(catalogKeys.length);
    expect([...catalogKeys].sort()).toEqual(Object.keys(manifestBuildings).sort());
  });

  it("freezes gameplay and placement metadata during the art migration", () => {
    for (const building of catalogBuildings) {
      const runtimeBuilding = manifestBuildings[building.key];
      expect(runtimeBuilding, building.key).toBeDefined();
      for (const field of frozenFields) {
        expect(building[field], `${building.key}.${field}`).toEqual(runtimeBuilding[field]);
      }
    }
  });

  it("contains no legacy source-kind classification", () => {
    const serialized = JSON.stringify(catalog);
    expect(serialized).not.toMatch(/artSource|sourceKind|procedural|imported/i);
  });

  it("preserves the 67 reviewed baseline while replacements progress", () => {
    const reviewed = catalogBuildings.filter((building) => building.reviewed).length;
    const pending = catalogBuildings.filter((building) => !building.reviewed).length;
    expect(reviewed).toBeGreaterThanOrEqual(67);
    expect(reviewed + pending).toBe(193);
  });

  it("pins every reviewed five-stage sheet by SHA-256", () => {
    for (const building of catalogBuildings.filter((entry) => entry.reviewed)) {
      expect(building.sheet, building.key).toBeTruthy();
      expect(building.sheetSha256, building.key).toMatch(/^[a-f0-9]{64}$/);
      const sheetPath = resolve(referenceRoot, building.sheet!);
      expect(existsSync(sheetPath), `${building.key}: ${sheetPath}`).toBe(true);
      const digest = createHash("sha256").update(readFileSync(sheetPath)).digest("hex");
      expect(digest, building.key).toBe(building.sheetSha256);
    }
  });

  it("does not mark a replacement ready without a reviewed source sheet", () => {
    for (const building of catalogBuildings) {
      expect(building.reviewed).toBe(Boolean(building.sheet && building.sheetSha256));
    }
  });
});
