import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../assets/pixel-city-pack/manifest.json";
import authoredProps from "../assets/pixel-city-pack/catalog/ai-authored-props.json";
import buildingCatalog from "../assets/pixel-city-pack/catalog/buildings.json";

const runtime = resolve("assets/pixel-city-pack/runtime");
const buildings = manifest.buildings as Record<string, {
  stages: string[];
  maxPerCity: number | null;
  maxPerDistrict: number | null;
  ruleIds: string[];
}>;

const expansionKeys = [
  "landmark-ferris-wheel", "landmark-megatall-tower", "landmark-monument",
  "house-garden-apartment", "house-apartment-walkup",
  "shop-cafe", "shop-butcher", "shop-electronics", "shop-furniture", "shop-bookstore",
  "shop-clothing", "shop-restaurant", "shop-bar", "office-small", "hotel-small",
  "commercial-market-stalls", "commercial-storage", "commercial-gas-station-electric",
  "commercial-gas-station-truck", "commercial-gas-station-cafe", "commercial-gas-station-wash",
  "civic-museum", "civic-hospital", "civic-university", "civic-courthouse", "civic-embassy",
  "civic-community-center", "civic-aquatic-center", "civic-transport-hub",
  "civic-waste-station", "civic-power-substation", "civic-memorial-hall", "civic-youth-center",
  "highrise-residential-tower", "highrise-hotel", "highrise-office",
  "highrise-medical-tower", "highrise-luxury-tower", "highrise-sustainable-tower",
] as const;

const retainedAuthoredBatch = [
  "shop-bakery-long", "shop-warehouse", "commercial-shopping-plaza", "commercial-corner-cafe",
  "commercial-pharmacy", "commercial-auto-repair",
  "commercial-gas-station-compact", "commercial-highway-service-plaza", "commercial-gas-station-electric",
  "commercial-gas-station-truck", "commercial-gas-station-cafe", "commercial-gas-station-wash",
  "landmark-ferris-wheel", "house-student-residence", "house-senior-living",
  "house-mediterranean-courtyard", "house-warehouse-lofts", "house-social-housing",
  "commercial-food-hall", "commercial-bowling",
  "commercial-bank-branch", "commercial-coworking", "commercial-tech-workshop",
  "commercial-car-dealership", "commercial-garden-center", "commercial-night-market",
  "commercial-department-store", "commercial-office-courtyard", "commercial-logistics-hub",
  "commercial-cold-storage", "commercial-maker-market", "commercial-rooftop-restaurant",
  "commercial-marina-office", "commercial-farmers-market", "commercial-hotel-boutique",
  "landmark-stadium", "civic-clinic", "civic-police", "civic-bank", "civic-post-office", "civic-theatre",
] as const;

describe("Pixel City active asset contract", () => {
  it("keeps retained families from the historical authored batch pinned to independent stages", () => {
    const catalog = new Map(buildingCatalog.buildings.map((building) => [building.key, building]));
    for (const key of retainedAuthoredBatch) {
      const building = catalog.get(key);
      expect(building, key).toMatchObject({ reviewed: true });
      expect(building, key).not.toHaveProperty("sheet");
      expect(building, key).not.toHaveProperty("sheetSha256");
      expect(building?.stageSources, key).toHaveLength(3);
      expect(building?.stageSha256, key).toHaveLength(3);
    }
  });

  it("forbids combined source sheets for every reviewed building family", () => {
    for (const building of buildingCatalog.buildings.filter((entry) => entry.reviewed)) {
      expect(building, building.key).not.toHaveProperty("sheet");
      expect(building, building.key).not.toHaveProperty("sheetSha256");
      expect(building.stageSources, building.key).toHaveLength(3);
      expect(building.stageSha256, building.key).toHaveLength(3);
      for (const digest of building.stageSha256 ?? []) {
        expect(digest, building.key).toMatch(/^[a-f0-9]{64}$/);
      }
    }
  });

  it("publishes one coherent V5 material profile for terrain and infrastructure", () => {
    const materialManifest = manifest as typeof manifest & {
      materialProfile?: string;
      tiles: Record<string, { visualProfile?: string; materialRole?: string }>;
    };
    expect(materialManifest.materialProfile).toBe("TASKTOPIA_V5_CITY_MATERIALS_2026");
    for (const [key, tile] of Object.entries(materialManifest.tiles)) {
      expect(tile.visualProfile, key).toBe("TASKTOPIA_V5_CITY_MATERIALS_2026");
      expect(tile.materialRole, key).toMatch(
        /^(GROUND|ROAD|FOOTWAY|MARKING|BRIDGE|CONSTRUCTION|CONSTRUCTION_OVERLAY)$/,
      );
    }
    expect(materialManifest.tiles).not.toHaveProperty("curb");
  });

  it("publishes every planned building as five distinct runtime stages", () => {
    for (const key of new Set([...expansionKeys, ...buildingCatalog.buildings.map((entry) => entry.key)])) {
      const building = buildings[key];
      expect(building, key).toBeDefined();
      expect(building.stages, key).toHaveLength(5);
      expect(new Set(building.stages).size, key).toBe(5);
      for (const stage of building.stages) expect(existsSync(resolve(runtime, stage)), `${key}: ${stage}`).toBe(true);
    }
  });

  it("keeps city landmarks unique in both the city and district", () => {
    for (const key of Object.keys(buildings).filter((key) => key.startsWith("landmark-"))) {
      expect(buildings[key]).toMatchObject({ maxPerCity: 1, maxPerDistrict: 1 });
      expect(buildings[key]!.ruleIds).toContain("UNIQUE_SERVICE");
    }
  });

  it("does not expose obsolete building-art provenance to the runtime", () => {
    for (const [key, building] of Object.entries(manifest.buildings)) {
      expect(building, key).not.toHaveProperty("artSource");
      expect(building, key).not.toHaveProperty("sourceSheet");
      expect(building, key).not.toHaveProperty("visualProjection");
    }
  });

  it("publishes the new tree, streetlight, and large park-prop families", () => {
    const props = manifest.props as Record<string, { footprintCells: number[] }>;
    for (const key of [
      "tree-birch", "tree-pine", "tree-willow", "tree-oak", "tree-apple", "tree-cherry",
      "tree-maple", "tree-cedar", "tree-cypress", "tree-palm", "tree-aspen", "tree-deadwood", "tree-magnolia", "tree-redwood",
      "shrub-hazel", "shrub-fern", "shrub-flowering", "shrub-dry", "shrub-hedge", "shrub-juniper",
      "streetlamp-vintage", "streetlamp-modern", "streetlamp-solar",
      "streetlamp-industrial", "streetlamp-double", "streetlamp-festive",
      "fountain-large", "gazebo", "bandstand", "statue-hero", "statue-abstract",
      "topiary-spiral", "topiary-animal", "pond-small", "flower-bed-horizontal",
      "flower-bed-vertical", "park-bench-double", "park-bridge", "park-lamp",
      "park-path-circle", "playground-slide", "playground-carousel",
      "playground-climbing", "playground-swing", "park-pond", "park-sculpture",
      "park-flower-clock", "park-bandstand", "bus-stop-horizontal", "bus-stop-vertical",
      "city-bus-horizontal", "city-bus-north", "city-bus-south",
    ]) expect(props[key], key).toBeDefined();
    expect(props["fountain-large"]?.footprintCells).toEqual([4, 4]);
    expect(props["gazebo"]?.footprintCells).toEqual([4, 3]);
  });

  it("keeps reviewed ambient art tied to its approved source and visual profile", () => {
    const props = manifest.props as Record<string, { size: number[]; footprintCells: number[]; artSource?: string; sourceSheet?: string; visualProfile?: string; baseFacing?: string }>;
    for (const authored of authoredProps) {
      expect(props[authored.key], authored.key).toMatchObject({
        size: authored.size,
        footprintCells: authored.footprintCells,
        artSource: "AI_AUTHORED",
        sourceSheet: authored.sheet,
        visualProfile: authored.visualProfile,
        ...("baseFacing" in authored ? { baseFacing: authored.baseFacing } : {}),
      });
    }
  });

  it("ships street furniture, lighting states, and low nature as reviewed authored art", () => {
    const props = manifest.props as Record<string, {
      artSource?: string;
      sourceSheet?: string;
      footprintCells: number[];
    }>;
    for (const key of [
      "bench-horizontal", "bench-vertical", "trash-bin", "recycling-bin",
      "streetlamp", "streetlamp-lit", "streetlamp-modern", "streetlamp-modern-lit",
      "streetlamp-double", "streetlamp-double-lit", "traffic-light-red", "traffic-light-green",
    ]) {
      expect(props[key], key).toMatchObject({
        artSource: "AI_AUTHORED",
        sourceSheet: "ai-authored/ambient/street-furniture-lighting-v1.png",
      });
    }
    for (const key of [
      "flower-white", "flower-yellow", "flower-red", "flower-pink", "flower-purple", "flower-blue",
      "bush-dark", "bush-light", "bush-berries", "rock-small", "rock-cluster",
      "reed-green", "reed-cattail", "shrub-hazel", "shrub-fern", "shrub-flowering",
      "shrub-dry", "shrub-hedge", "shrub-juniper", "tree-flowering",
    ]) {
      expect(props[key], key).toMatchObject({
        artSource: "AI_AUTHORED",
        sourceSheet: "ai-authored/ambient/nature-small-v1.png",
        footprintCells: [1, 1],
      });
    }
  });

  it("publishes the complete AI-authored construction kit for the two composable site stages", () => {
    const props = manifest.props as Record<string, {
      size: number[];
      footprintCells: number[];
      artSource?: string;
      visualProfile?: string;
      anchorPx: number[];
    }>;
    const details = Object.entries(props).filter(([key]) => key.startsWith("construction-plan-") || key.startsWith("construction-build-"));
    expect(details).toHaveLength(23);
    expect(details.filter(([key]) => key.startsWith("construction-plan-"))).toHaveLength(10);
    expect(details.filter(([key]) => key.startsWith("construction-build-"))).toHaveLength(13);
    for (const [key, detail] of details) {
      expect(detail.artSource, key).toBe("AI_AUTHORED");
      expect(detail.anchorPx, key).toEqual([detail.size[0] / 2, detail.size[1]]);
      expect(detail.footprintCells[0] * 8, key).toBeLessThanOrEqual(detail.size[0]);
      expect(detail.footprintCells[1] * 8, key).toBeLessThanOrEqual(detail.size[1]);
    }
  });

  it("ships a compact three-frame resident walk cycle in every direction", () => {
    const props = manifest.props as Record<string, { size: number[]; footprintCells: number[] }>;
    for (const direction of ["north", "east", "south", "west"]) {
      for (const frame of ["a", "b", "c"]) {
        expect(props[`walker-${direction}-${frame}`], `${direction}-${frame}`).toMatchObject({
          size: [16, 24],
          footprintCells: [1, 1],
          sourceSheet: "ai-authored/ambient/resident-walkers-v5.png",
        });
      }
    }
  });

  it("anchors every V5 tree inside one eight-pixel planting cell", () => {
    const props = manifest.props as Record<string, {
      size: number[];
      footprintCells: number[];
      anchorPx: number[];
      visualProfile?: string;
    }>;
    const trees = Object.entries(props).filter(([, prop]) => prop.visualProfile === "TASKTOPIA_V5_TREE_FRONTAL_TOP");
    expect(trees).toHaveLength(16);
    for (const [key, tree] of trees) {
      expect(tree, key).toMatchObject({
        size: [16, 32],
        footprintCells: [1, 1],
        anchorPx: [8, 32],
      });
    }
  });

  it("publishes eight independently authored directional vehicle models", () => {
    const vehicles = manifest.vehicles as Record<string, Record<"horizontal" | "north" | "south", { size: number[]; artSource?: string; sourceSheet?: string; visualProfile?: string; baseFacing?: string }>>;
    expect(Object.keys(vehicles)).toHaveLength(8);
    for (const [key, orientations] of Object.entries(vehicles)) {
      expect(orientations.horizontal, key).toMatchObject({ size: [16, 8], artSource: "AI_AUTHORED" });
      expect(orientations.north, key).toMatchObject({ size: [8, 16], artSource: "AI_AUTHORED" });
      expect(orientations.south, key).toMatchObject({ size: [8, 16], artSource: "AI_AUTHORED" });
      expect(orientations.horizontal.sourceSheet, key).toBe(orientations.north.sourceSheet);
      expect(orientations.horizontal.sourceSheet, key).toBe(orientations.south.sourceSheet);
      expect(orientations.horizontal, key).toMatchObject({ visualProfile: "TASKTOPIA_V5_OBLIQUE_ROAD_VEHICLE", baseFacing: "EAST" });
      expect(orientations.north, key).toMatchObject({ visualProfile: "TASKTOPIA_V5_OBLIQUE_ROAD_VEHICLE", baseFacing: "NORTH" });
      expect(orientations.south, key).toMatchObject({ visualProfile: "TASKTOPIA_V5_OBLIQUE_ROAD_VEHICLE", baseFacing: "SOUTH" });
    }
  });

  it("publishes four incident animation frames, three engine silhouettes, and eight animal species", () => {
    const props = manifest.props as Record<string, { footprintCells: number[] }>;
    for (const key of ["fire-engine-horizontal", "fire-engine-rescue", "fire-engine-ladder"]) expect(props[key], key).toBeDefined();
    for (const prefix of ["incident-flame", "incident-smoke"]) {
      for (const suffix of ["a", "b", "c", "d"]) expect(props[`${prefix}-${suffix}`], `${prefix}-${suffix}`).toBeDefined();
    }
    for (const species of ["fox", "deer", "rabbit", "boar", "duck", "sheep", "dog", "cat"]) {
      for (const direction of ["north", "east", "south", "west"]) for (const frame of ["a", "b", "c"]) {
        expect(props[`animal-${species}-${direction}-${frame}`], `${species}-${direction}-${frame}`).toBeDefined();
      }
    }
    for (const family of ["cyclist", "scooter"]) for (const view of ["horizontal", "north", "south"]) for (const frame of ["a", "b", "c"]) {
      expect(props[`${family}-${view}-${frame}`], `${family}-${view}-${frame}`).toBeDefined();
    }
  });
});
