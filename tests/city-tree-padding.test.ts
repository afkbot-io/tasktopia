import { describe, expect, it } from "vitest";
import { CityTreePadding } from "../src/client/city-tree-padding";
import { CityTerrainPadding } from "../src/client/city-terrain-padding";
import { CityRoadPadding } from "../src/client/city-road-padding";
import { terrainAt, isBuildableTerrain } from "../src/shared/world-terrain";
import { generateWorldDecorations } from "../src/shared/world-decorations";
import { compactTreeCover } from "../src/shared/compact-tree-placement";
import type { ChunkPayloadDto, TerrainCellDto } from "../src/shared/contracts";

const resident = (): ChunkPayloadDto => ({ payloadVersion: 2, contentHash: "resident", generatorVersion: "block-v1", terrainSeed: 1,
  publishedVersion: 1, lod: "DETAIL", chunkX: 3, chunkY: 4, size: 64, roadRuns: [], surfaceRuns: [], districts: [], tasks: [], worldFeatures: [],
  decorationContext: { treeGeometryVersion: 7, lightingVersion: 1, surfaceHaloRuns: [], blockedCellRuns: [], cityBounds: [], districts: [], tasks: [] } });
const key = (cell: { x: number; y: number }) => `${cell.x},${cell.y}`;
function setup(chunks: ChunkPayloadDto[] = [], road = false) {
  const scene = { chunkSize: 64, chunks, intercityRoads: road ? [{ id: "actual", fromCityId: "a", toCityId: "b", fromNodeId: "aa", toNodeId: "bb", widthCells: 3 as const,
    geometry: { start: { x: 256, y: 288 }, runs: [{ direction: "E" as const, length: 64 }] } }] : [] };
  const terrain = new CityTerrainPadding(1, 64, scene.chunks);
  const roads = new CityRoadPadding(scene, cell => isBuildableTerrain(terrainAt(1, cell.x, cell.y).terrain));
  return { scene, terrain, roads, trees: new CityTreePadding(scene, 1, terrain, roads) };
}
describe("same-generator natural trees beyond the resident city", () => {
  it("matches the existing natural grove identity at adjacent chunk seams, with no resident or non-tree entities", () => {
    const { trees, terrain } = setup([resident()]);
    expect(trees.get(3, 4)).toEqual([]);
    const ids = new Set<string>();
    for (const [x, y] of [[4, 3], [4, 4], [4, 5]] as const) {
      const material = terrain.get(x, y)!;
      const context: TerrainCellDto[] = [];
      for (let row = y * 64 - 2; row < (y + 1) * 64 + 2; row++) for (let column = x * 64 - 2; column < (x + 1) * 64 + 2; column++) {
        context.push({ x: column, y: row, ...terrainAt(1, column, row) });
      }
      const reference = generateWorldDecorations(1, material.chunk.terrain, new Set(), [], [], [], [], context,
        cell => terrainAt(1, cell.x, cell.y).terrain).filter(decoration => decoration.kind.startsWith("tree-") && decoration.id.startsWith(`${decoration.kind}:`));
      const actual = trees.get(x, y);
      expect(actual).toEqual(reference); expect(actual.length).toBeGreaterThan(20);
      for (const tree of actual) { expect(ids.has(tree.id)).toBe(false); ids.add(tree.id); }
    }
  });
  it("keeps the full crown away from canonical road pavement and known resident reserved sites", () => {
    const chunk = resident();
    chunk.decorationContext.blockedCellRuns = [{ start: { x: 255, y: 256 }, end: { x: 255, y: 319 } }];
    const { trees, roads } = setup([chunk], true);
    const padded = roads.get(4, 4)!;
    const blocked = new Set([...padded.roadContext.values(), ...padded.surfaceContext.values()].map(key));
    for (let y = 256; y <= 319; y++) blocked.add(`255,${y}`);
    const actual = trees.get(4, 4); expect(actual.length).toBeGreaterThan(20);
    for (const tree of actual) expect(compactTreeCover(tree.origin).some(cell => blocked.has(key(cell))), tree.id).toBe(false);
  });
  it("retains deterministic identities across prune and reverse-pan, without accumulating old chunks", () => {
    const { trees } = setup(); const first = trees.get(4, 4);
    expect(trees.get(4, 4)).toBe(first);
    trees.get(4, 5); expect(trees.cachedChunks).toBe(2);
    trees.retain([[4, 5]]); expect(trees.cachedChunks).toBe(1);
    expect(trees.get(4, 4)).toEqual(first);
    trees.retain([]); expect(trees.cachedChunks).toBe(0);
  });
});
