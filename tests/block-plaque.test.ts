import { expect, it } from "vitest";
import { blockTaskRange } from "../src/shared/block-plaque";
it("formats only actual consecutive task numbers, retaining gaps and deduplicating history", () => {
  expect(blockTaskRange([214, 212, 213, 214, 218, 220, 221])).toBe("212–214, 218, 220–221");
  expect(blockTaskRange([])).toBe("");
  expect(blockTaskRange([1, 2, 3])).toBe("1–3");
});
