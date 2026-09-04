import { describe, expect, it } from "vitest";
import {
  ROAD_ATLAS_VISUAL_PROFILE,
  roadAtlasConnectionMask,
  roadAtlasOverlayTile,
  roadAtlasSurfaceTile,
  roadAtlasTile,
} from "../src/shared/road-atlas";

describe("procedural road atlas", () => {
  it("uses the approved terrain-v4 cartoon material profile", () => {
    expect(ROAD_ATLAS_VISUAL_PROFILE).toBe("TASKTOPIA_TERRAIN_V4_CARTOON_2026");
  });

  it("selects one deterministic directional frame for every road class and bridges", () => {
    const local = roadAtlasTile({ x: 12, y: -7, mask: 0b1011, structure: "ROAD", roadClass: "LOCAL" });
    const highway = roadAtlasTile({ x: 12, y: -7, mask: 0b1011, structure: "ROAD", roadClass: "HIGHWAY" });
    const bridge = roadAtlasTile({ x: 12, y: -7, mask: 0b1011, structure: "BRIDGE", roadClass: "ARTERIAL" });

    expect(local).toMatchObject({ url: "atlas/road-v2/road.png", tileSize: 8, sourceX: 88, mask: 0b1011 });
    expect(local.sourceY).toBeLessThan(24);
    expect(highway.sourceY).toBeGreaterThanOrEqual(72);
    expect(highway.sourceY).toBeLessThan(96);
    expect(bridge.sourceY).toBeGreaterThanOrEqual(96);
    expect(bridge.sourceY).toBeLessThan(120);
    expect(roadAtlasTile({ x: 12, y: -7, mask: 0b1011, structure: "ROAD", roadClass: "LOCAL" })).toEqual(local);
  });

  it("builds reciprocal masks only from compatible neighbours", () => {
    const cells = new Map([
      ["0:-1", "SIDEWALK"],
      ["1:0", "SIDEWALK"],
      ["0:1", "PATH"],
      ["-1:0", "SIDEWALK"],
    ]);
    expect(roadAtlasConnectionMask("SIDEWALK", 0, 0, (x, y) => cells.get(`${x}:${y}`))).toBe(0b1011);
    expect(roadAtlasConnectionMask("PATH", 0, 0, (x, y) => cells.get(`${x}:${y}`))).toBe(0b0100);
  });

  it("selects masked surface frames without mixing pavement and paths", () => {
    const pavement = roadAtlasSurfaceTile("PAVEMENT", 4, 9, 15);
    const driveway = roadAtlasSurfaceTile("DRIVEWAY", 4, 9, 3);
    expect(pavement).toMatchObject({ url: "atlas/road-v2/surface.png", tileSize: 8, sourceX: 120, mask: 15 });
    expect(pavement.sourceY).toBeLessThan(24);
    expect(driveway.sourceY).toBeGreaterThanOrEqual(96);
    expect(driveway.sourceY).toBeLessThan(120);
  });

  it("maps markings, crossings, bridge rails and portals to immutable overlay frames", () => {
    expect(roadAtlasOverlayTile("CROSSWALK_H")).toMatchObject({ url: "atlas/road-v2/overlay.png", sourceX: 0 });
    expect(roadAtlasOverlayTile("MARKING_V")).toMatchObject({ sourceX: 24 });
    expect(roadAtlasOverlayTile("BRIDGE_RAIL_W")).toMatchObject({ sourceX: 56 });
    expect(roadAtlasOverlayTile("BRIDGE_PORTAL_S")).toMatchObject({ sourceX: 80, tileSize: 8 });
  });
});
