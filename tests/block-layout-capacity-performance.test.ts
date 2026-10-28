import { describe, expect, it } from "vitest";
import { compileBlockLayout } from "../src/server/world/block-layout-compiler";
import { CITY_SCENE_MAX_CHUNKS, citySceneChunkRange } from "../src/shared/city-capacity";

const input = (count: number, seed = 7, archetype = "MIXED_URBAN") => ({
  countryId: "capacity-country", cityId: "capacity-city", seed, revision: 1,
  districts: [{ id: "capacity-district", sequence: 0, archetype,
    tasks: Array.from({ length: count }, (_, index) => ({ id: `capacity-task-${index + 1}`, taskNumber: index + 1,
      buildingFamily: "compact-apartment-v1", facadeVariant: "south", constructionStage: 1 as const, autoVisualKind: true })) }],
});

describe("compiler capacity performance without geometry changes", () => {
  it("evaluates each exact trusted terrain rectangle at most once per compilation", () => {
    const calls = new Map<string, number>();
    const layout = compileBlockLayout({ ...input(200), canPlaceBlock(bounds) {
      const key = JSON.stringify(bounds); calls.set(key, (calls.get(key) ?? 0) + 1);
      return bounds.minY >= -2 && bounds.maxY <= 26;
    } });
    expect(layout.placements).toHaveLength(200);
    expect(Math.max(...calls.values()), "Repeated rejected frontier rectangles must reuse their trusted terrain result").toBe(1);
  });

  it.each([
    [200, 7, "MIXED_URBAN", "045fd1f5977bea19c461dc86cf61e416e102df95feb8a81d44618065f1fcf06d"],
    [1000, 424242, "NEW_BUILD", "6464ee6cc3907ee04b45ef7944be6ed75e4d2c24e5d3c2df251fa9664988c014"],
  ] as const)("preserves the frozen native %i-task layout checksum", (count, seed, archetype, checksum) => {
    expect(compileBlockLayout(input(count, seed, archetype)).checksum).toBe(checksum);
  });

  it("keeps the exact pre-index 10k layout while exceeding the legacy chunk limit", () => {
    const layout = compileBlockLayout(input(10_000, 424242, "NEW_BUILD"));
    expect(layout.placements).toHaveLength(10_000);
    expect(layout.checksum).toBe("d224f56c9d3a5954ca59c62fd920b5e77e9531e5a7e4e1f643438e730c775956");
    expect(citySceneChunkRange(layout.bounds).count).toBeGreaterThan(256);
    expect(citySceneChunkRange(layout.bounds).count).toBeLessThanOrEqual(CITY_SCENE_MAX_CHUNKS);
  }, 30_000);
});
