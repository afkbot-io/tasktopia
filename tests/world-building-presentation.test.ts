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
import { constructionStageLayout } from "../src/shared/construction-stage";
import { rectangleFootprint } from "../src/server/world/grid";

const entry = getBuilding("compact-apartment-v1");

describe("compact building presentation", () => {
  it("uses the task number as a compact house badge", () => {
    expect(buildingBadgePresentation(7, 1)).toEqual({
      label: "7", width: 8, height: 8, fontSize: 6, borderColor: 0x9b72d2,
    });
    expect(buildingBadgePresentation(42, 4)).toEqual({
      label: "42", width: 10, height: 8, fontSize: 6, borderColor: 0x4fa5d7,
    });
    expect(buildingBadgePresentation(1024, 5).width).toBe(18);
  });

  it.each([3, 4, 5])("stage %s interaction follows actual opaque pixels, not transparent sky", (stage) => {
    const opaque = entry.stageOpaqueBounds[stage - 1]!;
    expect(buildingInteractiveBounds(entry, stage, 6)).toEqual({
      x: opaque.left - entry.anchor.x, y: opaque.top - entry.anchor.y,
      width: opaque.right - opaque.left, height: opaque.bottom - opaque.top,
    });
    expect(opaque.top).toBeGreaterThan(0);
    expect(opaque.bottom).toBe(48);
  });

  it.each([1, 2])("stage %s hitbox encloses the full physical site and one-cell fence", (stage) => {
    const layout = constructionStageLayout(entry.footprint, 3, stage);
    const hitbox = buildingInteractiveBounds(entry, stage, layout.padDepth);
    expect(hitbox).toEqual({ x: -32, y: -56, width: 64, height: 64 });
    for (const tile of [...layout.rearFence, ...layout.frontFence, ...layout.site]) {
      const x = tile.x * 8 - 24;
      const y = tile.y * 8;
      expect(x).toBeGreaterThanOrEqual(hitbox.x);
      expect(y).toBeGreaterThanOrEqual(hitbox.y);
      expect(x + 8).toBeLessThanOrEqual(hitbox.x + hitbox.width);
      expect(y + 8).toBeLessThanOrEqual(hitbox.y + hitbox.height);
    }
  });

  it.each([0, 1, 2])("stage %s adds no premature pavement platform", (stage) => {
    expect(taskPlatformCells(rectangleFootprint({ x: 10, y: 20 }, 6, 6), stage)).toEqual([]);
  });

  it.each([3, 4, 5])("stage %s platform stays exactly on the 6×6 reserved slot", (stage) => {
    const footprint = rectangleFootprint({ x: -3, y: 20 }, 6, 6);
    const platform = taskPlatformCells(footprint, stage);
    expect(platform).toBe(footprint);
    expect(platform).toHaveLength(36);
    expect(new Set(platform.map((cell) => cell.y))).toEqual(new Set([20, 21, 22, 23, 24, 25]));
    expect(new Set(platform.map((cell) => cell.x))).toEqual(new Set([-3, -2, -1, 0, 1, 2]));
  });

  it("uses the same pavement surface as sidewalks, without inferred yards or fuel courts", () => {
    expect(taskPlatformPresentation(entry)).toEqual({ family: "surface", key: "PAVEMENT" });
    expect(taskPlatformCellPresentation(entry)).toEqual({ family: "surface", key: "PAVEMENT" });
    expect(taskPlatformPresentation({ ...entry, platform: "YARD" }))
      .toEqual({ family: "terrain", key: "GRASS", variant: 1 });
  });

  it("retains explicit platform materials for non-building world features", () => {
    expect(buildingPlatformPresentation("YARD")).toEqual({ family: "terrain", key: "GRASS", variant: 1 });
    expect(buildingPlatformPresentation("STONE")).toEqual({ family: "surface", key: "PAVEMENT" });
    expect(buildingPlatformPresentation("ASPHALT")).toEqual({ family: "surface", key: "DRIVEWAY" });
    expect(buildingPlatformPresentation("SERVICE")).toEqual({ family: "surface", key: "PAVEMENT" });
    expect(buildingPlatformPresentation("PARK")).toEqual({ family: "terrain", key: "MEADOW", variant: 1 });
  });

  it("does not mutate or fill holes in an input footprint", () => {
    const cells = Object.freeze([{ x: 1, y: 2 }, { x: 3, y: 2 }]);
    expect(taskPlatformCells([...cells], 5)).toEqual(cells);
    expect(taskPlatformCells([], 5)).toEqual([]);
  });
});
