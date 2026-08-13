import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import catalog from "../assets/pixel-city-pack/catalog/buildings.json";
import manifest from "../assets/pixel-city-pack/manifest.json";

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
  stageSources?: string[] | null;
  stageSha256?: string[] | null;
  reviewed: boolean;
};

type RuntimeBuilding = Omit<CatalogBuilding, "key" | "reviewed"> & {
  stages: string[];
};

const referenceRoot = resolve("assets/pixel-city-pack/reference");
const manifestBuildings = manifest.buildings as Record<string, RuntimeBuilding>;
const catalogBuildings = catalog.buildings as CatalogBuilding[];

const frozenFields = [
  "label",
  "category",
  "rarity",
  "platform",
  "estimates",
  "tags",
  "ruleIds",
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

  it("keeps geometry mutable only for explicit reviewed stage migrations", () => {
    for (const building of catalogBuildings) {
      const runtimeBuilding = manifestBuildings[building.key];
      expect(runtimeBuilding, building.key).toBeDefined();
      const geometryFields = ["spriteSize", "footprintCells", "anchorPx", "entrances"] as const;
      for (const field of geometryFields) {
        expect(building[field], `${building.key}.${field}`).toEqual(runtimeBuilding[field]);
      }
      if (building.stageSources?.length === 3) {
        expect(building.anchorPx[0] * 2, building.key).toBe(building.spriteSize[0]);
        expect(building.anchorPx[1], building.key).toBe(building.spriteSize[1]);
        expect(building.spriteSize[0] % 8, building.key).toBe(0);
        expect(building.spriteSize[1] % 8, building.key).toBe(0);
      }
    }
  });

  it("contains no legacy source-kind classification", () => {
    const serialized = JSON.stringify(catalog);
    expect(serialized).not.toMatch(/artSource|sourceKind|procedural|imported|sheet/i);
  });

  it("publishes all 193 families through the reviewed V5 contract", () => {
    const reviewed = catalogBuildings.filter((building) => building.reviewed).length;
    const pending = catalogBuildings.filter((building) => !building.reviewed).length;
    expect(reviewed).toBe(193);
    expect(pending).toBe(0);
  });

  it("pins every reviewed source family by SHA-256", () => {
    for (const building of catalogBuildings.filter((entry) => entry.reviewed)) {
      expect(building.stageSources, building.key).toHaveLength(3);
      expect(building.stageSha256, building.key).toHaveLength(3);
      building.stageSources!.forEach((stageSource, index) => {
        const stagePath = resolve(referenceRoot, stageSource);
        expect(existsSync(stagePath), `${building.key}: ${stagePath}`).toBe(true);
        const digest = createHash("sha256").update(readFileSync(stagePath)).digest("hex");
        expect(digest, `${building.key}: stage ${index + 3}`).toBe(building.stageSha256![index]);
      });
    }
  });

  it("does not mark a replacement ready without a complete reviewed source", () => {
    for (const building of catalogBuildings) {
      const hasStages = building.stageSources?.length === 3
        && building.stageSha256?.length === building.stageSources?.length;
      expect(building.reviewed).toBe(hasStages);
    }
  });

  it("registers the balcony tower as three authored late stages", () => {
    const tower = catalogBuildings.find((building) => building.key === "highrise-residential-tower");
    expect(tower).toMatchObject({
      spriteSize: [144, 280],
      footprintCells: [18, 16],
      anchorPx: [72, 280],
      entrances: [{ side: "S", offset: 9 }],
      reviewed: true,
    });
    expect(tower?.stageSources).toHaveLength(3);
    expect(new Set(tower?.stageSources).size).toBe(3);
  });

  it("registers the glass tower in the shared-early-stage migration", () => {
    const tower = catalogBuildings.find((building) => building.key === "highrise-glass");
    expect(tower).toMatchObject({
      spriteSize: [96, 224],
      footprintCells: [12, 10],
      anchorPx: [48, 224],
      entrances: [{ side: "S", offset: 6 }],
      maxPerDistrict: 1,
      reviewed: true,
    });
    expect(tower?.stageSources).toHaveLength(3);
    expect(new Set(tower?.stageSources).size).toBe(3);

    const migratedNewBuilds = catalogBuildings.filter(
      (building) => building.tags.includes("new-build") && building.stageSources?.length === 3,
    );
    expect(migratedNewBuilds).toHaveLength(50);
  });

  it("publishes the regenerated civic-library geometry without shrinking it to the old catalog size", () => {
    const library = catalogBuildings.find((building) => building.key === "civic-library");
    expect(library).toMatchObject({
      spriteSize: [96, 112],
      footprintCells: [12, 8],
      anchorPx: [48, 112],
      entrances: [{ side: "S", offset: 6 }],
      reviewed: true,
    });
    expect(manifestBuildings["civic-library"]).toMatchObject({
      spriteSize: [96, 112],
      footprintCells: [12, 8],
      anchorPx: [48, 112],
      entrances: [{ side: "S", offset: 6 }],
    });
  });

  it("publishes the compact fire station as a full-size V5 civic building", () => {
    const station = catalogBuildings.find((building) => building.key === "civic-fire-station-compact");
    expect(station).toMatchObject({
      spriteSize: [96, 96],
      footprintCells: [12, 8],
      anchorPx: [48, 96],
      entrances: [{ side: "S", offset: 6 }],
      reviewed: true,
      stageSources: expect.arrayContaining([
        "ai-authored/building-stage-study/civic-fire-station-compact-v5/sources/stage-3.png",
        "ai-authored/building-stage-study/civic-fire-station-compact-v5/sources/stage-4.png",
        "ai-authored/building-stage-study/civic-fire-station-compact-v5/sources/stage-5.png",
      ]),
    });
  });

  it("registers the luxury tower with shared early construction stages", () => {
    const tower = catalogBuildings.find((building) => building.key === "highrise-luxury-tower");
    expect(tower).toMatchObject({
      spriteSize: [112, 256],
      footprintCells: [14, 12],
      anchorPx: [56, 256],
      entrances: [{ side: "S", offset: 7 }],
      reviewed: true,
    });
    expect(tower?.stageSources).toHaveLength(3);
    expect(new Set(tower?.stageSources).size).toBe(3);
  });

  it("registers the hotel as three authored V5 stages on one large footprint", () => {
    const hotel = catalogBuildings.find((building) => building.key === "highrise-hotel");
    expect(hotel).toMatchObject({
      spriteSize: [112, 256],
      footprintCells: [14, 12],
      anchorPx: [56, 256],
      entrances: [{ side: "S", offset: 7 }],
      reviewed: true,
    });
    expect(hotel?.stageSources).toHaveLength(3);
    expect(new Set(hotel?.stageSources).size).toBe(3);
  });

  it("registers the Art Deco tower with a deep roof-matched foundation", () => {
    const tower = catalogBuildings.find((building) => building.key === "highrise-art-deco");
    expect(tower).toMatchObject({
      spriteSize: [112, 256],
      footprintCells: [14, 12],
      anchorPx: [56, 256],
      entrances: [{ side: "S", offset: 7 }],
      reviewed: true,
    });
    expect(tower?.stageSources).toHaveLength(3);
    expect(new Set(tower?.stageSources).size).toBe(3);
  });

  it("registers the office tower as three aligned authored V5 stages", () => {
    const tower = catalogBuildings.find((building) => building.key === "highrise-office");
    expect(tower).toMatchObject({
      spriteSize: [112, 256],
      footprintCells: [14, 12],
      anchorPx: [56, 256],
      entrances: [{ side: "S", offset: 7 }],
      reviewed: true,
    });
    expect(tower?.stageSources).toHaveLength(3);
    expect(new Set(tower?.stageSources).size).toBe(3);
  });

  it("registers the medical tower on its wider V5 hospital footprint", () => {
    const tower = catalogBuildings.find((building) => building.key === "highrise-medical-tower");
    expect(tower).toMatchObject({
      spriteSize: [128, 256],
      footprintCells: [16, 12],
      anchorPx: [64, 256],
      entrances: [{ side: "S", offset: 8 }],
      reviewed: true,
    });
    expect(tower?.stageSources).toHaveLength(3);
    expect(new Set(tower?.stageSources).size).toBe(3);
  });
});
