import { describe, expect, it } from "vitest";
import {
  buildingBadgePresentation,
  buildingPlatformPresentation,
  taskPlatformCellPresentation,
  taskPlatformPresentation,
} from "../src/client/world-building-presentation";
import { getBuilding } from "../src/shared/catalog";

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

  it("renders every new-build task on continuous pavement", () => {
    expect(taskPlatformPresentation(getBuilding("house-apartment-walkup")))
      .toEqual({ family: "tile", key: "pavement" });
    expect(taskPlatformPresentation(getBuilding("highrise-glass")))
      .toEqual({ family: "tile", key: "pavement" });
  });

  it("keeps dense residential blocks urban while ordinary houses receive yards", () => {
    expect(taskPlatformPresentation(getBuilding("house-small-apartments")))
      .toEqual({ family: "tile", key: "pavement" });
    expect(taskPlatformPresentation(getBuilding("house-cottage")))
      .toEqual({ family: "terrain", key: "GRASS", variant: 1 });
  });

  it("turns an ordinary house footprint into a deterministic residential yard", () => {
    const entry = {
      ...getBuilding("house-cottage"),
      footprint: { width: 6, height: 5 },
      entrances: [{ side: "S" as const, offset: 3 }],
    };
    const footprint = Array.from({ length: 5 }, (_, row) =>
      Array.from({ length: 6 }, (_unused, column) => ({ x: 10 + column, y: 20 + row })),
    ).flat();

    const presentations = footprint.map((cell) => taskPlatformCellPresentation(
      entry,
      footprint,
      cell,
      17,
      3,
    ));

    expect(taskPlatformCellPresentation(entry, footprint, { x: 13, y: 24 }, 17, 3))
      .toEqual({ family: "tile", key: "path-brown" });
    expect(taskPlatformCellPresentation(entry, footprint, { x: 13, y: 23 }, 17, 3))
      .toEqual({ family: "tile", key: "path-brown" });
    expect(presentations).not.toContainEqual({ family: "tile", key: "pavement" });
    expect(new Set(presentations.map((presentation) => JSON.stringify(presentation))).size).toBeGreaterThanOrEqual(3);
    expect(footprint.map((cell) => taskPlatformCellPresentation(entry, footprint, cell, 17, 3)))
      .toEqual(presentations);
  });

  it("keeps new-build footprints paved cell by cell", () => {
    const entry = getBuilding("house-apartment-walkup");
    const footprint = [{ x: 4, y: 8 }, { x: 5, y: 8 }, { x: 4, y: 9 }, { x: 5, y: 9 }];
    expect(footprint.map((cell) => taskPlatformCellPresentation(entry, footprint, cell, 4, 1)))
      .toEqual(footprint.map(() => ({ family: "tile", key: "pavement" })));
  });
});
