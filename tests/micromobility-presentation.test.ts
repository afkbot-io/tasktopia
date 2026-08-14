import { describe, expect, it } from "vitest";
import { micromobilityOccupancy, micromobilityPresentation } from "../src/client/micromobility-presentation";

describe("micromobility presentation", () => {
  it("uses three-frame authored views and mirrors only the horizontal westbound view", () => {
    expect(micromobilityPresentation("cyclist", { x: 1, y: 1 }, { x: 2, y: 1 }, 0)).toEqual({ key: "cyclist-horizontal-a", scaleX: 0.85, scaleY: 0.85 });
    expect(micromobilityPresentation("cyclist", { x: 2, y: 1 }, { x: 1, y: 1 }, 1)).toEqual({ key: "cyclist-horizontal-b", scaleX: -0.85, scaleY: 0.85 });
    expect(micromobilityPresentation("scooter", { x: 1, y: 2 }, { x: 1, y: 1 }, 2)).toEqual({ key: "scooter-north-c", scaleX: 0.85, scaleY: 0.85 });
    expect(micromobilityPresentation("scooter", { x: 1, y: 1 }, { x: 1, y: 2 }, 3)).toEqual({ key: "scooter-south-a", scaleX: 0.85, scaleY: 0.85 });
  });

  it("reserves two path cells only for the long horizontal silhouette", () => {
    expect(micromobilityOccupancy({ x: 1, y: 1 }, { x: 2, y: 1 })).toEqual([{ x: 1, y: 1 }, { x: 2, y: 1 }]);
    expect(micromobilityOccupancy({ x: 2, y: 1 }, { x: 1, y: 1 })).toEqual([{ x: 2, y: 1 }, { x: 1, y: 1 }]);
    expect(micromobilityOccupancy({ x: 1, y: 1 }, { x: 1, y: 2 })).toEqual([{ x: 1, y: 1 }]);
  });
});
