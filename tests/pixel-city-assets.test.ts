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

describe("Pixel City active asset contract", () => {
  it("does not publish superseded standalone road and footway sprites", () => {
    const obsolete = [
      "road", "pavement", "path-brown", "path-pavers", "path-asphalt",
      "crosswalk-horizontal", "crosswalk-vertical",
      "road-marking-horizontal", "road-marking-vertical",
      "bridge-side-horizontal", "bridge-side-vertical",
    ];
    for (const key of obsolete) {
      expect(manifest.tiles).not.toHaveProperty(key);
      expect(existsSync(resolve(runtime, "tiles", `${key}.png`)), key).toBe(false);
    }
  });

  it("packs every prop into one immutable particle atlas", () => {
    const assetManifest = manifest as typeof manifest & {
      propAtlas?: {
        path: string;
        size: [number, number];
        frames: Record<string, { x: number; y: number; width: number; height: number }>;
      };
    };
    const atlas = assetManifest.propAtlas;
    expect(atlas).toBeDefined();
    expect(atlas!.size[0]).toBeLessThanOrEqual(2048);
    expect(atlas!.size[1]).toBeLessThanOrEqual(2048);
    expect(existsSync(resolve(runtime, atlas!.path))).toBe(true);
    expect(Object.keys(atlas!.frames).sort()).toEqual(Object.keys(manifest.props).sort());
    for (const [key, prop] of Object.entries(manifest.props as unknown as Record<string, { size: [number, number] }>)) {
      const frame = atlas!.frames[key];
      expect(frame, key).toMatchObject({ width: prop.size[0], height: prop.size[1] });
      expect(frame!.x + frame!.width, key).toBeLessThanOrEqual(atlas!.size[0]);
      expect(frame!.y + frame!.height, key).toBeLessThanOrEqual(atlas!.size[1]);
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

  it("publishes only full 4px lawn and water surfaces for block-v1 interiors", () => {
    const blockSurfaceManifest = manifest as typeof manifest & {
      blockSurfaces?: {
        schemaVersion: number;
        cellPx: number;
        visualProfile: string;
        tiles: Record<string, {
          path: string;
          size: [number, number];
          opaque: boolean;
          materialRole: string;
        }>;
      };
    };
    expect(blockSurfaceManifest.blockSurfaces).toEqual({
      schemaVersion: 1,
      cellPx: 4,
      visualProfile: "TASKTOPIA_BLOCK_V1_MICRO_SURFACES_2026",
      tiles: {
        "block-lawn": {
          path: "block-surfaces/block-lawn.png",
          size: [4, 4],
          opaque: true,
          materialRole: "LAWN",
        },
        "block-water": {
          path: "block-surfaces/block-water.png",
          size: [4, 4],
          opaque: true,
          materialRole: "WATER",
        },
      },
    });
    expect(Object.keys(blockSurfaceManifest.blockSurfaces!.tiles)).toEqual(["block-lawn", "block-water"]);
    for (const surface of Object.values(blockSurfaceManifest.blockSurfaces!.tiles)) {
      expect(existsSync(resolve(runtime, surface.path)), surface.path).toBe(true);
    }
  });

  it("publishes every planned building as five distinct runtime stages", () => {
    for (const key of buildingCatalog.buildings.map((entry) => entry.key)) {
      const building = buildings[key];
      expect(building, key).toBeDefined();
      expect(building.stages, key).toHaveLength(5);
      expect(new Set(building.stages).size, key).toBe(5);
      for (const stage of building.stages) expect(existsSync(resolve(runtime, stage)), `${key}: ${stage}`).toBe(true);
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
      "shrub-flowering",
      "streetlamp-vintage", "streetlamp-modern", "streetlamp-solar",
      "streetlamp-industrial", "streetlamp-double", "streetlamp-festive",
      "fountain-large", "gazebo", "bandstand", "statue-hero", "statue-abstract",
      "topiary-spiral", "topiary-animal", "pond-small", "flower-bed-horizontal",
      "flower-bed-vertical", "park-bench-double", "park-bridge", "park-lamp",
      "park-path-circle", "playground-slide", "playground-carousel",
      "playground-climbing", "playground-swing", "park-pond", "park-sculpture",
      "park-flower-clock", "park-bandstand", "bus-stop-horizontal", "bus-stop-vertical",
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
        artSource: "artSource" in authored ? authored.artSource : "AI_AUTHORED",
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
      "flower-white", "flower-yellow", "flower-pink", "shrub-flowering",
    ]) {
      expect(props[key], key).toMatchObject({
        artSource: "AI_AUTHORED",
        sourceSheet: "ai-authored/ambient/nature-small-v2.png",
        footprintCells: [1, 1],
      });
    }
  });

  it("publishes the compact shared construction kit and no oversized legacy pieces", () => {
    const props = manifest.props as Record<string, { size: number[]; footprintCells: number[]; artSource?: string; anchorPx: number[] }>;
    const details = Object.entries(props).filter(([key]) => key.startsWith("compact-construction-"));
    expect(details).toHaveLength(4);
    expect(Object.keys(props).some((key) => key.startsWith("construction-"))).toBe(false);
    for (const [key, detail] of details) {
      expect(detail.artSource, key).toBe("PROCEDURAL_TILE_KIT");
      expect(detail.anchorPx, key).toEqual([detail.size[0] / 2, detail.size[1]]);
      expect(Math.max(...detail.size), key).toBeLessThanOrEqual(24);
      expect(Math.max(...detail.footprintCells), key).toBeLessThanOrEqual(2);
    }
  });


  it("anchors every compact high-45 tree inside one eight-pixel planting cell", () => {
    const props = manifest.props as Record<string, {
      size: number[];
      footprintCells: number[];
      anchorPx: number[];
      visualProfile?: string;
    }>;
    const trees = Object.entries(props).filter(([key]) => key.startsWith("tree-"));
    expect(trees).toHaveLength(17);
    for (const [key, tree] of trees) {
      expect(tree, key).toMatchObject({
        visualProfile: "TASKTOPIA_V7_TREE_COMPACT_45_GRID",
        size: [16, 16],
        footprintCells: [1, 1],
        anchorPx: [8, 16],
      });
    }
  });

  it("publishes only the micro moving-ambient profile with no old bus, gait or car paths", () => {
    expect(manifest).not.toHaveProperty("vehicles");
    expect(manifest.microAmbient.visualProfile).toBe("TASKTOPIA_MICRO_TOPDOWN_CARTOON_V1");
    expect(Object.keys(manifest.microAmbient.sprites)).toHaveLength(36);
    expect(Object.keys(manifest.props).filter((key) => /^(walker|resident|fisher|animal|cyclist|scooter|city-bus)-/.test(key))).toEqual([]);
  });

  it("does not publish the superseded incident PNG animation path", () => {
    const props = manifest.props as Record<string, { size: number[]; occupiedSize?: number[]; footprintCells: number[]; artSource?: string; sourceSheet?: string; sourceSha256?: string; visualProfile?: string; baseFacing?: string }>;
    expect(Object.keys(props).filter(key => key.startsWith("fire-engine-"))).toEqual([]);
    expect(Object.keys(props).filter(key => /^incident-(flame|smoke)-/.test(key))).toEqual([]);

  });
});
