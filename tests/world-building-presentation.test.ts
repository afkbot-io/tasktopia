import { describe, expect, it } from "vitest";
import { buildingBadgePresentation, buildingPlatformPresentation } from "../src/client/world-building-presentation";

describe("building badge presentation", () => {
  it("uses the task number as the compact house number", () => {
    expect(buildingBadgePresentation(7, 1)).toEqual({
      label: "7",
      width: 8,
      height: 8,
      fontSize: 6,
      borderColor: 0x9b72d2,
    });
    expect(buildingBadgePresentation(42, 4)).toEqual({
      label: "42",
      width: 10,
      height: 8,
      fontSize: 6,
      borderColor: 0x4fa5d7,
    });
  });
});

describe("building platform presentation", () => {
  it("keeps world buildings on the platform declared by their catalog entry", () => {
    expect(buildingPlatformPresentation("YARD")).toEqual({ family: "terrain", key: "GRASS", variant: 1 });
    expect(buildingPlatformPresentation("STONE")).toEqual({ family: "tile", key: "pavement" });
    expect(buildingPlatformPresentation("ASPHALT")).toEqual({ family: "tile", key: "road" });
    expect(buildingPlatformPresentation("SERVICE")).toEqual({ family: "tile", key: "pavement" });
    expect(buildingPlatformPresentation("PARK")).toEqual({ family: "terrain", key: "MEADOW", variant: 1 });
  });
});
