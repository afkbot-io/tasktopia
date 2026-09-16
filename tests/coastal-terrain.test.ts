import { expect, it } from "vitest";
import { isBuildableTerrain, terrainAt } from "../src/shared/world-terrain";
import { parseWorldTerrainProfile, type WorldTerrainProfile } from "../src/shared/world-terrain-profile";

const profile: WorldTerrainProfile = { version: 1, kind: "EAST_COAST", coastX: 256 };

it("has a connected deep sea east of its authored coast, independent of viewport bounds", () => {
  for (const seed of [1, 42, 123, 424242]) {
    for (let y = -200; y <= 200; y += 5) {
      for (const x of [272, 320, 1000, 100000]) {
        const cell = terrainAt(seed, x, y, profile);
        expect(cell.terrain).toBe("DEEP_WATER");
        expect(isBuildableTerrain(cell.terrain)).toBe(false);
      }
    }
  }
});

it("preserves classic worlds and every inland sample outside the new coast band", () => {
  for (const seed of [1, 42, 123]) for (let y = -200; y <= 200; y += 7) for (let x = -200; x < 230; x += 11) {
    expect(terrainAt(seed, x, y, profile)).toEqual(terrainAt(seed, x, y));
    expect(terrainAt(seed, x, y, undefined)).toEqual(terrainAt(seed, x, y));
  }
});

it("rejects malformed persisted profiles rather than silently changing their geography", () => {
  expect(parseWorldTerrainProfile(null)).toBeUndefined();
  expect(parseWorldTerrainProfile(profile)).toEqual(profile);
  for (const value of [{ ...profile, version: 2 }, { ...profile, kind: "LAKE" }, { ...profile, coastX: 1.5 },
    { ...profile, coastX: Infinity }, { ...profile, coastX: "256" }, {}, []]) {
    expect(() => parseWorldTerrainProfile(value)).toThrow("Invalid world terrain profile");
  }
});
