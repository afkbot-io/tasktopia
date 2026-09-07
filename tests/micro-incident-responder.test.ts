import { describe, expect, it } from "vitest";
import { microIncidentResponder } from "../src/client/micro-incident-responder";

describe("native incident responder", () => {
  it("uses the authored west-facing micro car and places beacon/hose inside the one-cell vehicle site", () => {
    for (const width of [24, 48]) {
      const responder = microIncidentResponder(width);
      expect(responder.visual).toMatchObject({ key: "micro-car-red-west", width: 8, height: 8, anchor: { x: 4, y: 4 } });
      expect(responder.center.x - 4).toBe(width / 2);
      expect(responder.center.y).toBe(-4);
      for (const point of [responder.beacon, responder.hose]) {
        expect(point.x).toBeGreaterThanOrEqual(width / 2);
        expect(point.x).toBeLessThanOrEqual(width / 2 + 8);
        expect(point.y).toBeGreaterThanOrEqual(-8);
        expect(point.y).toBeLessThanOrEqual(0);
      }
    }
  });
});
