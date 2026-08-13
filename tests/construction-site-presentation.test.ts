import { describe, expect, it } from "vitest";
import { constructionSiteFence } from "../src/client/construction-site-presentation";

describe("construction site presentation", () => {
  it("keeps a one-cell fence outside the projected construction pad and opens a south gate", () => {
    expect(constructionSiteFence({ width: 18, height: 16 }, 9, 4)).toEqual({
      bounds: { left: -80, top: -48, right: 80, bottom: 8 },
      gate: { left: -8, right: 8 },
    });
  });

  it("removes temporary fencing from the completed fifth stage", () => {
    expect(constructionSiteFence({ width: 18, height: 16 }, 9, 5)).toBeNull();
  });
});
