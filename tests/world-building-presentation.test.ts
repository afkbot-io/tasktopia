import { describe, expect, it } from "vitest";
import {
  buildingBadgePresentation,
  buildingInteractiveBounds,
  buildingPlatformPresentation,
  taskPlatformCellPresentation,
  taskPlatformCells,
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

describe("building interactive bounds", () => {
  it("does not expose transparent sky above an unfinished authored stage", () => {
    const entry = getBuilding("highrise-glass");
    const opaque = entry.stageOpaqueBounds[2]!;
    expect(buildingInteractiveBounds(entry, 3, 5)).toEqual({
      x: opaque.left - entry.anchor.x,
      y: opaque.top - entry.anchor.y,
      width: opaque.right - opaque.left,
      height: opaque.bottom - opaque.top,
    });
    expect(opaque.top).toBeGreaterThan(0);
  });

  it("keeps shared planning and foundation modules clickable", () => {
    const entry = getBuilding("highrise-glass");
    expect(buildingInteractiveBounds(entry, 1, 5)).toEqual({ x: -56, y: -56, width: 112, height: 64 });
  });
});

describe("building platform presentation", () => {
  it("keeps an unfinished construction platform as shallow as its visible site", () => {
    const footprint = Array.from({ length: 12 }, (_, row) =>
      Array.from({ length: 16 }, (_unused, column) => ({ x: 10 + column, y: 20 + row })),
    ).flat();

    const cells = taskPlatformCells(footprint, 1);
    expect(new Set(cells.map((cell) => cell.y))).toEqual(new Set([27, 28, 29, 30, 31]));
    expect(cells).toHaveLength(16 * 5);
  });

  it("keeps the complete physical platform after the facade appears", () => {
    const footprint = Array.from({ length: 6 }, (_, row) =>
      Array.from({ length: 10 }, (_unused, column) => ({ x: column, y: row })),
    ).flat();
    expect(taskPlatformCells(footprint, 3)).toEqual(footprint);
  });

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

  it("keeps both low- and mid-rise residential complexes on pavement", () => {
    expect(taskPlatformPresentation(getBuilding("house-small-apartments")))
      .toEqual({ family: "tile", key: "pavement" });
    expect(taskPlatformPresentation(getBuilding("house-lowrise-gallery")))
      .toEqual({ family: "tile", key: "pavement" });
  });

  it("paves every low-rise residential footprint cell", () => {
    const entry = {
      ...getBuilding("house-lowrise-gallery"),
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

    expect(presentations).toEqual(footprint.map(() => ({ family: "tile", key: "pavement" })));
    expect(footprint.map((cell) => taskPlatformCellPresentation(entry, footprint, cell, 17, 3)))
      .toEqual(presentations);
  });

  it("keeps new-build footprints paved cell by cell", () => {
    const entry = getBuilding("house-apartment-walkup");
    const footprint = [{ x: 4, y: 8 }, { x: 5, y: 8 }, { x: 4, y: 9 }, { x: 5, y: 9 }];
    expect(footprint.map((cell) => taskPlatformCellPresentation(entry, footprint, cell, 4, 1)))
      .toEqual(footprint.map(() => ({ family: "tile", key: "pavement" })));
  });

  it("builds a compact fuel forecourt instead of a full road-tile rectangle", () => {
    const entry = getBuilding("commercial-gas-station");
    const footprint = Array.from({ length: 7 }, (_, row) =>
      Array.from({ length: 14 }, (_unused, column) => ({ x: 20 + column, y: 30 + row })),
    ).flat();

    expect(taskPlatformCellPresentation(entry, footprint, { x: 26, y: 35 }, 9, 5))
      .toEqual({ family: "tile", key: "path-asphalt" });
    expect(taskPlatformCellPresentation(entry, footprint, { x: 20, y: 35 }, 9, 5))
      .toEqual({ family: "terrain", key: "GRASS", variant: expect.any(Number) });
    expect(taskPlatformCellPresentation(entry, footprint, { x: 26, y: 30 }, 9, 5))
      .toEqual({ family: "tile", key: "pavement" });
  });
});
