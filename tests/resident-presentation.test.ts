import { describe, expect, it } from "vitest";
import {
  residentGroundPosition,
} from "../src/client/resident-presentation";

describe("resident presentation", () => {
  it("keeps the animal ground anchor on the centreline of every walk cell", () => {
    expect(residentGroundPosition({ x: 2, y: 3 }, { x: 3, y: 3 }, 0, 8)).toEqual({ x: 20, y: 28 });
    expect(residentGroundPosition({ x: 2, y: 3 }, { x: 3, y: 3 }, 0.5, 8)).toEqual({ x: 24, y: 28 });
    expect(residentGroundPosition({ x: 3, y: 3 }, { x: 3, y: 4 }, 1, 8)).toEqual({ x: 28, y: 36 });
  });

});
