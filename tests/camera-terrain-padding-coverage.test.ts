import { describe, expect, it } from "vitest";
import type { Rect } from "../src/shared/contracts";
import { cameraTerrainPadding } from "../src/client/camera-terrain-padding";
import { planCityResidency } from "../src/client/city-residency";
import { chunkRangeForViewport, type CameraPosition, type ChunkCoordinate, type ScreenSize } from "../src/client/world-camera";

const chunkSize = 64;
const cellSize = 8;
const key = ([x, y]: ChunkCoordinate) => `${x},${y}`;
const cityChunks = (offset: number) => [
  { chunkX: offset, chunkY: offset }, { chunkX: offset + 1, chunkY: offset },
  { chunkX: offset, chunkY: offset + 1 }, { chunkX: offset + 1, chunkY: offset + 1 },
];

type Fixture = {
  name: string;
  cityBounds: Rect;
  navigationBounds: Rect;
  chunks: Array<{ chunkX: number; chunkY: number }>;
  position: CameraPosition;
  screen: ScreenSize;
};
const positiveBounds = { minX: 0, minY: 0, maxX: 127, maxY: 127 };
const negativeBounds = { minX: -128, minY: -128, maxX: -1, maxY: -1 };
const runtimeFixtures: Fixture[] = [
  {
    name: "ordinary positive resident rectangle",
    cityBounds: positiveBounds, navigationBounds: positiveBounds, chunks: cityChunks(0),
    position: { x: 128, y: 128 }, screen: { width: 768, height: 768 },
  },
  {
    name: "ordinary negative resident rectangle",
    cityBounds: negativeBounds, navigationBounds: negativeBounds, chunks: cityChunks(-2),
    position: { x: 1152, y: 1152 }, screen: { width: 768, height: 768 },
  },
  {
    name: "north rail navigation expansion without scene chunks",
    cityBounds: positiveBounds, navigationBounds: { ...positiveBounds, minY: -64 }, chunks: cityChunks(0),
    position: { x: 0, y: 512 }, screen: { width: 512, height: 512 },
  },
  {
    name: "north rail navigation expansion at negative coordinates",
    cityBounds: negativeBounds, navigationBounds: { ...negativeBounds, minY: -192 }, chunks: cityChunks(-2),
    position: { x: 1024, y: 1536 }, screen: { width: 512, height: 512 },
  },
];
// Generic Set authority may be irregular even though today's server publishes
// a full chunk rectangle and includes port extensions in DTO city bounds.
const authorityFixtures: Fixture[] = [
  {
    name: "irregular authoritative exterior set with a neighbouring terrain gap",
    cityBounds: positiveBounds, navigationBounds: { ...positiveBounds, minY: -64 },
    chunks: [...cityChunks(0), { chunkX: 0, chunkY: -1 }],
    position: { x: 0, y: 512 }, screen: { width: 1024, height: 512 },
  },
  {
    name: "authoritative scene chunk beyond the city-bounds residency halo",
    cityBounds: positiveBounds, navigationBounds: { ...positiveBounds, minY: -128 },
    chunks: [...cityChunks(0), { chunkX: 0, chunkY: -2 }],
    position: { x: 0, y: 1024 }, screen: { width: 512, height: 512 },
  },
];

// Independent screen-space intersection, including only positive-area overlap.
// All fixtures and their one-chunk halos fit inside this bounded search window.
function viewportChunks(position: CameraPosition, screen: ScreenSize): ChunkCoordinate[] {
  const visible: ChunkCoordinate[] = [];
  for (let y = -8; y <= 8; y++) for (let x = -8; x <= 8; x++) {
    const left = x * chunkSize * cellSize + position.x;
    const top = y * chunkSize * cellSize + position.y;
    if (left < screen.width && left + chunkSize * cellSize > 0
      && top < screen.height && top + chunkSize * cellSize > 0) visible.push([x, y]);
  }
  return visible;
}

describe.each([0, 1])("CITY viewport terrain ownership with padding halo %i", halo => {
  it.each(runtimeFixtures)("covers every visible chunk: $name", fixture => {
    const visible = viewportChunks(fixture.position, fixture.screen);
    expect(visible.length).toBeGreaterThan(0);
    const required = new Set<string>();
    for (const [x, y] of visible) for (let dy = -halo; dy <= halo; dy++) for (let dx = -halo; dx <= halo; dx++) {
      required.add(key([x + dx, y + dy]));
    }

    const authoritative = new Set(fixture.chunks.map(chunk => key([chunk.chunkX, chunk.chunkY])));
    // Navigation bounds can include a railway region without scene data;
    // resident selection still uses canonical DTO bounds and actual scene keys.
    const range = chunkRangeForViewport(fixture.position, 1, fixture.screen, fixture.cityBounds, cellSize, chunkSize);
    const resident = planCityResidency(fixture.chunks, range, chunkSize);
    const residentKeys = new Set(resident.wanted.map(key));
    const padding = cameraTerrainPadding(fixture.position, 1, fixture.screen, authoritative, cellSize, chunkSize, halo);
    const paddingKeys = new Set(padding.map(key));
    const covered = new Set([...residentKeys, ...paddingKeys]);

    expect([...required].filter(id => !covered.has(id)).sort(), "Terrain chunks without either a resident or padding owner").toEqual([]);
    // Authoritative chunks retain their real scene data; padding cannot cover
    // a missing resident load by substituting generated terrain over that data.
    expect(visible.filter(coordinate => authoritative.has(key(coordinate)) && !residentKeys.has(key(coordinate))).map(key)).toEqual([]);
    expect([...paddingKeys].filter(id => authoritative.has(id))).toEqual([]);
  });

  it.each(authorityFixtures)("covers the generic authoritative footprint without substituting its data: $name", fixture => {
    const visible = viewportChunks(fixture.position, fixture.screen);
    const required = new Set<string>();
    for (const [x, y] of visible) for (let dy = -halo; dy <= halo; dy++) for (let dx = -halo; dx <= halo; dx++) {
      required.add(key([x + dx, y + dy]));
    }
    const authoritative = new Set(fixture.chunks.map(chunk => key([chunk.chunkX, chunk.chunkY])));
    const padding = cameraTerrainPadding(fixture.position, 1, fixture.screen, authoritative, cellSize, chunkSize, halo);
    const paddingKeys = new Set(padding.map(key));
    const covered = new Set([...authoritative, ...paddingKeys]);

    expect([...required].filter(id => !covered.has(id)).sort()).toEqual([]);
    expect([...paddingKeys].filter(id => authoritative.has(id))).toEqual([]);
    expect([...paddingKeys].sort()).toEqual([...required].filter(id => !authoritative.has(id)).sort());
  });
});
