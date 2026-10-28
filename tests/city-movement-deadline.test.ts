import { describe, expect, it } from "vitest";
import { cityMovementTimeoutMs } from "../src/client/city-movement-deadline";

describe("bounded canonical city background deadline", () => {
  it("preserves the previous 20s budget through1000tasks and256chunks", () => {
    for (const [tasks, chunks] of [[0, 0], [200, 9], [1000, 64], [1000, 256]])
      expect(cityMovementTimeoutMs(tasks!, chunks!)).toBe(20_000);
  });
  it("scales by either full task workload or extent and stops at90s", () => {
    expect(cityMovementTimeoutMs(10_000, 576)).toBe(90_000);
    expect(cityMovementTimeoutMs(200, 576)).toBe(90_000); // A large emptied city can retain roads/ruins.
    expect(cityMovementTimeoutMs(5500, 256)).toBe(55_000);
    expect(cityMovementTimeoutMs(1000, 416)).toBe(55_000);
    expect(cityMovementTimeoutMs(1001, 256)).toBe(20_008);
    expect(cityMovementTimeoutMs(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toBe(90_000);
  });
  it("rejects missing, fractional, negative, unsafe or nonfinite workload metadata", () => {
    for (const invalid of [undefined, NaN, Infinity, -Infinity, -1, .5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => cityMovementTimeoutMs(invalid as number, 1)).toThrow("Invalid canonical city workload");
      expect(() => cityMovementTimeoutMs(1, invalid as number)).toThrow("Invalid canonical city workload");
    }
  });
});
