import { describe, expect, it } from "vitest";
import { pairedBusStopCandidates } from "../src/server/world/transit";

describe("paired bus-stop geometry", () => {
  it("places two 2x2 platforms outside opposite sides of a horizontal road", () => {
    const candidates = pairedBusStopCandidates({ x: 20, y: 10 }, "HORIZONTAL", 4);
    const [north, south] = candidates[0]!;
    expect(north.assetKey).toBe("bus-stop-horizontal");
    expect(south.assetKey).toBe("bus-stop-horizontal");
    expect(north.footprint).toHaveLength(4);
    expect(south.footprint).toHaveLength(4);
    expect(Math.max(...north.footprint.map((cell) => cell.y))).toBe(7);
    expect(Math.min(...south.footprint.map((cell) => cell.y))).toBe(12);
    expect(north.origin.x).not.toBe(south.origin.x);
  });

  it("places two 2x2 platforms outside opposite sides of a vertical road", () => {
    const [[west, east]] = pairedBusStopCandidates({ x: -5, y: 4 }, "VERTICAL", 2);
    expect(west.assetKey).toBe("bus-stop-vertical");
    expect(Math.max(...west.footprint.map((cell) => cell.x))).toBe(-7);
    expect(Math.min(...east.footprint.map((cell) => cell.x))).toBe(-4);
    expect(west.origin.y).not.toBe(east.origin.y);
  });
});
