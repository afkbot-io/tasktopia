import { describe, expect, it } from "vitest";
import { placeCityMobilitySignalPosts, type CityMobilitySignalPost } from "../src/client/city-mobility-signal-posts";
const post: CityMobilitySignalPost = { id: "cross:N", origin: { x: 0, y: 0 }, axis: "V", approach: "N" };
const makeInput = () => ({ posts: [post], terrain: new Map(Array.from({ length: 25 }, (_, i) => [`${i % 5 - 2},${Math.floor(i / 5) - 2}`, { terrain: "GRASS" as const }])), roads: new Set(["1,0", "1,1"]), walkGraph: new Set(["0,0"]), blocked: new Set<string>() });
describe("curb-mounted signal posts", () => {
  it("keeps the post at the roadside sidewalk without changing pedestrian navigation", () => {
    const input = makeInput();
    expect(placeCityMobilitySignalPosts(input)).toEqual([post]);
    expect([...input.walkGraph]).toEqual(["0,0"]);
  });
  it("omits distant posts rather than placing them in a field", () => {
    const input = makeInput(); input.roads.clear();
    expect(placeCityMobilitySignalPosts(input)).toEqual([]);
  });
  it("never puts a post on the road or inside a building", () => {
    const input = makeInput(); input.blocked.add("0,0");
    expect(placeCityMobilitySignalPosts(input)).toEqual([]);
    for (const result of placeCityMobilitySignalPosts(input)) {
      expect(input.roads.has(`${result.origin.x},${result.origin.y}`)).toBe(false);
      expect(input.blocked.has(`${result.origin.x},${result.origin.y}`)).toBe(false);
    }
  });
  it("does not use unknown terrain beside a road", () => {
    const input = makeInput(); input.terrain.clear();
    expect(placeCityMobilitySignalPosts(input)).toEqual([]);
  });
  it("rejects a water cell even when it is adjacent to a road", () => {
    const input = makeInput();
    expect(placeCityMobilitySignalPosts({ ...input, terrain: new Map([["0,0", { terrain: "DEEP_WATER" as const }]]) })).toEqual([]);
  });
  it("does not multiply posts at the same curb point", () => {
    const input = makeInput(); input.posts = [post, { ...post, id: "other:N" }];
    expect(placeCityMobilitySignalPosts(input)).toHaveLength(1);
  });
});
