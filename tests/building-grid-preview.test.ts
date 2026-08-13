import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("standalone building grid preview", () => {
  it("places an 18x16 building on a centered 20x30 pavement grid", () => {
    const stdout = execFileSync(
      ".venv-assets/bin/python",
      ["scripts/render-building-grid-preview.py", "--describe-layout"],
      { encoding: "utf8" },
    );

    expect(JSON.parse(stdout)).toEqual({
      cellSize: 8,
      site: { columns: 20, rows: 30, widthPx: 160, heightPx: 240 },
      building: {
        widthCells: 18,
        depthCells: 16,
        heightCells: 35,
        origin: { x: 1, y: 7 },
        anchorPx: { x: 80, y: 184 },
        spriteSizePx: { width: 144, height: 280 },
      },
      canvas: { widthPx: 160, heightPx: 336, platformOffsetYPx: 96 },
    });
  });

  it("uses five quiet 8x8 pavement variants with frontal-top lighting", () => {
    const stdout = execFileSync(
      ".venv-assets/bin/python",
      ["scripts/render-building-grid-preview.py", "--describe-pavement"],
      { encoding: "utf8" },
    );

    expect(JSON.parse(stdout)).toEqual({
      tileSizePx: { width: 8, height: 8 },
      variantCount: 5,
      paletteColorCount: 6,
      projection: "orthogonal-frontal-top",
      lightDirection: "upper-left",
      seams: "single shared one-pixel top-and-left joint",
    });
  });
});
