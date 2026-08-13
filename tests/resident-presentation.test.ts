import { describe, expect, it } from "vitest";
import {
  residentActivityPosition,
  residentActivityVisualKey,
  residentGroundPosition,
  residentWalkPresentation,
} from "../src/client/resident-presentation";

describe("resident presentation", () => {
  it("cycles through three authored stride frames without rotating the resident sprite", () => {
    expect(residentWalkPresentation({ x: 1, y: 1 }, { x: 2, y: 1 }, 0.10, 0)).toEqual({
      key: "walker-east-a",
      scaleX: 1,
      scaleY: 1,
    });
    expect(residentWalkPresentation({ x: 1, y: 1 }, { x: 2, y: 1 }, 0.40, 0)).toEqual({
      key: "walker-east-b",
      scaleX: 1,
      scaleY: 1,
    });
    expect(residentWalkPresentation({ x: 1, y: 1 }, { x: 2, y: 1 }, 0.72, 0)).toEqual({
      key: "walker-east-c",
      scaleX: 1,
      scaleY: 1,
    });
    expect(residentWalkPresentation({ x: 2, y: 1 }, { x: 1, y: 1 }, 0.72, 0)).toEqual({
      key: "walker-west-c",
      scaleX: 1,
      scaleY: 1,
    });
  });

  it("uses independently authored front and rear walk frames", () => {
    expect(residentWalkPresentation({ x: 3, y: 4 }, { x: 3, y: 3 }, 0.1, 0).key).toBe("walker-north-a");
    expect(residentWalkPresentation({ x: 3, y: 3 }, { x: 3, y: 4 }, 0.1, 0).key).toBe("walker-south-a");
  });

  it("positions a speech bubble in world space above the resident head", () => {
    expect(residentActivityPosition({ x: 84, y: 96 }, 16, 1)).toEqual({ x: 84, y: 76 });
  });

  it("keeps the resident foot anchor on the centreline of every walk cell", () => {
    expect(residentGroundPosition({ x: 2, y: 3 }, { x: 3, y: 3 }, 0, 8)).toEqual({ x: 20, y: 28 });
    expect(residentGroundPosition({ x: 2, y: 3 }, { x: 3, y: 3 }, 0.5, 8)).toEqual({ x: 24, y: 28 });
    expect(residentGroundPosition({ x: 3, y: 3 }, { x: 3, y: 4 }, 1, 8)).toEqual({ x: 28, y: 36 });
  });

  it("keeps the same resident identity while thinking or talking", () => {
    expect(residentActivityVisualKey("walker-south-b", "THINK")).toBe("walker-south-b");
    expect(residentActivityVisualKey("walker-south-b", "CHAT")).toBe("walker-south-b");
  });
});
