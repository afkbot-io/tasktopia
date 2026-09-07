import { describe, expect, it } from "vitest";
import manifest from "../assets/pixel-city-pack/manifest.json";

describe("compact world asset regression", () => {
  it("does not publish a curb tile that can leak back into road rendering", () => {
    expect(Object.hasOwn(manifest.tiles, "curb")).toBe(false);
  });
});
