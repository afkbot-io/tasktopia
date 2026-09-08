import { expect, it } from "vitest";
import { blockTaskRange, blockPlaqueRange } from "../src/shared/block-plaque";
it("formats the inclusive number span despite gaps and duplicated history", () => {
  expect(blockTaskRange([214, 212, 213, 214, 218, 220, 221])).toBe("212–221");
  expect(blockTaskRange([])).toBe("");
  expect(blockTaskRange([1, 2, 3])).toBe("1–3");
});

it("spans missing task numbers", () => { expect(blockTaskRange([93, 85])).toBe("85–93"); });

it("normalizes cached labels without rebuilding a saved city", () => { expect(blockPlaqueRange("212–214, 218, 220–221")).toBe("212–221"); });
