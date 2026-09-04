import { describe, expect, it } from "vitest";
import { decorationWorldAnchor } from "../src/client/decoration-placement";

describe("decoration placement", () => {
  it("plants trees at the centre of their terrain cell while preserving x alignment", () => {
    expect(decorationWorldAnchor("tree-oak", { x: 7, y: 11 }, { width: 1, height: 1 }, 8))
      .toEqual({ x: 60, y: 92 });
  });

  it("keeps ordinary props on the bottom-centre footprint anchor", () => {
    expect(decorationWorldAnchor("bench-horizontal", { x: 7, y: 11 }, { width: 2, height: 1 }, 8))
      .toEqual({ x: 64, y: 96 });
  });
});
