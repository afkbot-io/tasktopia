import { describe, expect, it } from "vitest";
import { animalPresentation } from "../src/client/animal-presentation";
import { micromobilityPresentation } from "../src/client/micromobility-presentation";
import { residentWalkPresentation } from "../src/client/resident-presentation";

describe("moving-agent animation presentation", () => {
  it("uses an integer render scale for crisp resident frames", () => {
    const frames = [0.05, 0.3, 0.55, 0.8].map((progress) =>
      residentWalkPresentation({ x: 1, y: 1 }, { x: 2, y: 1 }, progress, 0),
    );

    expect(frames.map((frame) => frame.key)).toEqual([
      "walker-east-a", "walker-east-b", "walker-east-c", "walker-east-b",
    ]);
    expect(frames.every(({ scaleX, scaleY }) => Number.isInteger(scaleX) && Number.isInteger(scaleY))).toBe(true);
  });

  it("mirrors horizontal micromobility without changing its vertical scale", () => {
    const east = micromobilityPresentation("cyclist", { x: 1, y: 1 }, { x: 2, y: 1 }, 0);
    const west = micromobilityPresentation("cyclist", { x: 2, y: 1 }, { x: 1, y: 1 }, 0);

    expect(west.key).toBe(east.key);
    expect(west.scaleX).toBe(-east.scaleX);
    expect(west.scaleY).toBe(east.scaleY);
    expect(Math.abs(west.scaleX)).toBe(west.scaleY);
  });

  it("derives animal facing from movement and mirrors only the west view", () => {
    expect(animalPresentation("fox", { x: 2, y: 2 }, { x: 3, y: 2 }, 1)).toEqual({
      key: "animal-fox-east-b", scaleX: 1, scaleY: 1,
    });
    expect(animalPresentation("fox", { x: 2, y: 2 }, { x: 1, y: 2 }, 1)).toEqual({
      key: "animal-fox-east-b", scaleX: -1, scaleY: 1,
    });
    expect(animalPresentation("fox", { x: 2, y: 2 }, { x: 2, y: 1 }, 2)).toEqual({
      key: "animal-fox-north-c", scaleX: 1, scaleY: 1,
    });
    expect(animalPresentation("fox", { x: 2, y: 2 }, { x: 2, y: 3 }, 0)).toEqual({
      key: "animal-fox-south-a", scaleX: 1, scaleY: 1,
    });
  });
});
