import { describe, expect, it } from "vitest";
import type { Cell, TerrainKind } from "../src/shared/contracts";
import { PROP_CATALOG } from "../src/shared/catalog";
import { placeCityMobilitySignalPosts, type CityMobilitySignalPost } from "../src/client/city-mobility-signal-posts";

const key = ({ x, y }: Cell) => `${x},${y}`;
const post = (id = "junction:N", approach: CityMobilitySignalPost["approach"] = "N"): CityMobilitySignalPost => ({
  id, origin: { x: 0, y: 0 }, axis: approach === "N" || approach === "S" ? "V" : "H", approach,
});
function input(posts: CityMobilitySignalPost[] = [post()]) {
  const terrain = new Map<string, { terrain: TerrainKind }>();
  for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) terrain.set(`${x},${y}`, { terrain: "GRASS" });
  return { posts, terrain, roads: new Set<string>(), walkGraph: new Set<string>(), blocked: new Set<string>() };
}

describe("physical traffic-post placement without sidewalk surgery", () => {
  it("matches the native traffic post's one-cell physical support contract", () => {
    for (const color of ["red", "green"]) expect(PROP_CATALOG[`traffic-light-${color}`]!.footprint).toEqual({ width: 1, height: 1 });
  });

  it("keeps an already safe authored curb location and its signal identity", () => {
    const source = input();
    const result = placeCityMobilitySignalPosts(source);
    expect(result).toEqual(source.posts);
    expect(result[0]).not.toBe(source.posts[0]);
    expect(result[0]!.origin).not.toBe(source.posts[0]!.origin);
  });

  it.each(["roads", "walkGraph", "blocked"] as const)("moves away from %s without removing any of its cells", obstruction => {
    const source = input();
    source[obstruction].add("0,0");
    const result = placeCityMobilitySignalPosts(source);
    expect(result).toEqual([{ ...post(), origin: { x: 0, y: -1 } }]);
    expect([...source[obstruction]]).toEqual(["0,0"]);
    expect(source.posts[0]!.origin).toEqual({ x: 0, y: 0 });
  });

  it.each(["DEEP_WATER", "SHALLOW_WATER", "WET_SAND", "MOUNTAIN", "HILL", "FOREST"] as TerrainKind[])("rejects a %s cell even when no obstacle was published", terrain => {
    const source = input();
    source.terrain.set("0,0", { terrain });
    expect(placeCityMobilitySignalPosts(source)[0]!.origin).toEqual({ x: 0, y: -1 });
  });

  it.each(["GRASS", "MEADOW", "DIRT", "SAND"] as TerrainKind[])("accepts known unobstructed %s ground", terrain => {
    const source = input();
    source.terrain.set("0,0", { terrain });
    expect(placeCityMobilitySignalPosts(source)[0]!.origin).toEqual({ x: 0, y: 0 });
  });

  it.each([
    ["N", { x: -1, y: -1 }, { x: 1, y: 0 }],
    ["E", { x: 1, y: -1 }, { x: 0, y: 1 }],
    ["S", { x: 1, y: 1 }, { x: -1, y: 0 }],
    ["W", { x: -1, y: 1 }, { x: 0, y: -1 }],
  ] as const)("keeps %s on its own outside approach corner", (approach, expected, inward) => {
    const source = input([post(`junction:${approach}`, approach)]);
    source.terrain.clear();
    source.terrain.set(key(expected), { terrain: "GRASS" });
    source.terrain.set(key(inward), { terrain: "GRASS" });
    expect(placeCityMobilitySignalPosts(source)).toEqual([{ ...source.posts[0]!, origin: expected }]);
  });

  it("omits a post instead of breaking a one-cell sidewalk or using unknown/far-away ground", () => {
    const source = input();
    for (const cell of source.terrain.keys()) source.walkGraph.add(cell);
    source.terrain.set("0,-3", { terrain: "GRASS" });
    source.walkGraph.delete("0,-3"); // Outside the two-cell search radius.
    const before = [...source.walkGraph];
    expect(placeCityMobilitySignalPosts(source)).toEqual([]);
    expect([...source.walkGraph]).toEqual(before);
    source.terrain.clear(); // Missing resident terrain never implies safe grass.
    source.walkGraph.clear();
    expect(placeCityMobilitySignalPosts(source)).toEqual([]);
  });

  it("allocates distinct cells deterministically when nearby posts compete", () => {
    const a = post("a:N"), b = post("b:N");
    const result = placeCityMobilitySignalPosts(input([b, a]));
    expect(result).toEqual(placeCityMobilitySignalPosts(input([a, b])));
    expect(result.map(p => p.id)).toEqual(["a:N", "b:N"]);
    expect(result.map(p => p.origin)).toEqual([{ x: 0, y: 0 }, { x: 0, y: -1 }]);
    expect(new Set(result.map(p => key(p.origin))).size).toBe(result.length);
  });

  it("accepts map-backed road/walk membership without copying the whole graph", () => {
    const source = input();
    expect(placeCityMobilitySignalPosts({ ...source, roads: new Map([["0,0", { x: 0, y: 0 }]]) })[0]!.origin)
      .toEqual({ x: 0, y: -1 });
  });
});
