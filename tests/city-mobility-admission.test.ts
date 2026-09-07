import { describe, expect, it } from "vitest";
import { mobilityExitAvailable, mobilityPassageExit, type CityMobilityAgent } from "../src/client/city-mobility";

const car: CityMobilityAgent = {
  id: "incoming", kind: "CAR", variant: "blue", direction: "east", current: { x: 0, y: 0 }, next: { x: 1, y: 0 },
  position: { x: .5, y: .5 }, progress: 0, speed: .002, steps: 0, activity: "NONE", waitMs: 0, yieldReason: "NONE",
};

describe("complete conflict-zone admission", () => {
  it("rejects an incomplete crossing path instead of inventing an exit", () => {
    const zone = { cells: new Set(["1,0", "2,0", "3,0"]) };
    expect(mobilityPassageExit([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }], zone)).toBeUndefined();
    expect(mobilityPassageExit([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 }], zone)).toEqual({ x: 4, y: 0 });
  });

  it("checks the complete body at an exit, not just its cell or another car's centre", () => {
    const exit = { x: 4, y: 0 };
    const blockingCar = { ...car, id: "queue-tail", position: { x: 5, y: .5 } };
    expect(mobilityExitAvailable(exit, car, [blockingCar])).toBe(false);
    const blockingPerson: CityMobilityAgent = { ...car, id: "crossing-person", kind: "WALKER", variant: "teal", position: { x: 4.5, y: .5 } };
    expect(mobilityExitAvailable(exit, car, [blockingPerson])).toBe(false);
    expect(mobilityExitAvailable(exit, car, [{ ...blockingCar, position: { x: 6, y: .5 } }])).toBe(true);
    expect(mobilityExitAvailable(exit, car, [{ ...car, position: { x: 4.5, y: .5 } }])).toBe(true);
  });
});
