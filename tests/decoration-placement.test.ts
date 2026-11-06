import { describe, expect, it } from "vitest";
import { decorationWorldAnchor, decorationSpriteCellBounds } from "../src/client/decoration-placement";

describe("decoration placement", () => {
  it("plants trees at the centre of their terrain cell while preserving x alignment", () => {
    expect(decorationWorldAnchor("tree-oak", { x: 7, y: 11 }, { width: 1, height: 1 }, 8))
      .toEqual({ x: 60, y: 92 });
  });

  it("keeps ordinary props on the bottom-centre footprint anchor", () => {
    expect(decorationWorldAnchor("bench-horizontal", { x: 7, y: 11 }, { width: 2, height: 1 }, 8))
      .toEqual({ x: 64, y: 96 });
  });

  it("reserves the authored sprite envelope without extra cells below a streetlamp", () => {
    expect(decorationSpriteCellBounds("streetlamp", { x: 17, y: -58 }, {
      footprint: { width: 1, height: 1 }, size: { width: 8, height: 16 }, anchor: { x: 4, y: 16 },
    }, 8)).toEqual({ minX: 17, maxX: 17, minY: -59, maxY: -58 });
  });

  it("includes every partial cell of an overhanging tree at negative coordinates", () => {
    expect(decorationSpriteCellBounds("tree-oak", { x: -2, y: -3 }, {
      footprint: { width: 1, height: 1 }, size: { width: 24, height: 32 }, anchor: { x: 12, y: 32 },
    }, 8)).toEqual({ minX: -3, maxX: -1, minY: -7, maxY: -3 });
  });
});
