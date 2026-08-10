import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../assets/pixel-city-pack-v4/manifest.json";
import v5Buildings from "../assets/pixel-city-pack-v4/catalog/generated-buildings-v5.json";
import authoredProps from "../assets/pixel-city-pack-v4/catalog/ai-authored-props.json";

const runtime = resolve("assets/pixel-city-pack-v4/runtime");
const buildings = manifest.buildings as Record<string, {
  stages: string[];
  maxPerCity: number | null;
  maxPerDistrict: number | null;
  ruleIds: string[];
}>;

const expansionKeys = [
  "landmark-ferris-wheel", "landmark-megatall-tower", "landmark-monument",
  "house-colonial", "house-craftsman", "house-ranch", "house-split-level",
  "house-townhouse-brick", "house-townhouse-stone", "house-garden-apartment",
  "house-eco-cottage", "house-narrow-shotgun", "house-courtyard-block",
  "house-modern-villa", "house-duplex-brick", "house-studio-loft",
  "house-rowhouse-corner", "house-suburban-brick", "house-apartment-walkup",
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

describe("Pixel City V4 expansion contract", () => {
  it("publishes every planned building as five distinct runtime stages", () => {
    for (const key of [...expansionKeys, ...v5Buildings.map((entry) => entry.key)]) {
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
    const props = manifest.props as Record<string, { size: number[]; footprintCells: number[]; artSource?: string; sourceSheet?: string; visualProfile?: string }>;
    for (const authored of authoredProps) {
      expect(props[authored.key], authored.key).toMatchObject({
        size: authored.size,
        footprintCells: authored.footprintCells,
        artSource: "AI_AUTHORED",
        sourceSheet: authored.sheet,
        visualProfile: authored.visualProfile,
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
      expect(orientations.horizontal, key).toMatchObject({ visualProfile: "TASKTOPIA_V4_FRONTAL_TOP_ROAD_VEHICLE", baseFacing: "EAST" });
      expect(orientations.north, key).toMatchObject({ visualProfile: "TASKTOPIA_V4_FRONTAL_TOP_ROAD_VEHICLE", baseFacing: "NORTH" });
      expect(orientations.south, key).toMatchObject({ visualProfile: "TASKTOPIA_V4_FRONTAL_TOP_ROAD_VEHICLE", baseFacing: "SOUTH" });
    }
  });

  it("publishes four incident animation frames, three engine silhouettes, and eight animal species", () => {
    const props = manifest.props as Record<string, { footprintCells: number[] }>;
    for (const key of ["fire-engine-horizontal", "fire-engine-rescue", "fire-engine-ladder"]) expect(props[key], key).toBeDefined();
    for (const prefix of ["incident-flame", "incident-smoke"]) {
      for (const suffix of ["a", "b", "c", "d"]) expect(props[`${prefix}-${suffix}`], `${prefix}-${suffix}`).toBeDefined();
    }
    for (const species of ["fox", "deer", "rabbit", "boar", "duck", "sheep", "dog", "cat"]) {
      for (const direction of ["north", "east", "south", "west"]) expect(props[`animal-${species}-${direction}`], `${species}-${direction}`).toBeDefined();
    }
  });
});
