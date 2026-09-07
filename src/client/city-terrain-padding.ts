import type { Cell, ChunkDto, TerrainCellDto } from "../shared/contracts";
import { atlasTerrainKindFromWorld, type AtlasTerrainKind } from "../shared/atlas-scene";
import { terrainAt } from "../shared/world-terrain";

export type TerrainGroundChunk = Pick<ChunkDto, "chunkX" | "chunkY" | "size" | "terrain">;
export type PaddingTerrainMaterial = { chunk: TerrainGroundChunk; kindAt: (x: number, y: number) => AtlasTerrainKind | undefined };
export class CityTerrainPadding {
  private readonly residents;
  private readonly cache = new Map<string, PaddingTerrainMaterial>();
  private readonly captures = new Map<string, { cellAt: (x: number, y: number) => TerrainCellDto; kindAt: PaddingTerrainMaterial["kindAt"] }>();
  constructor(seed: number, private readonly size: number, resident: Iterable<Pick<ChunkDto, "chunkX" | "chunkY">>,
    private readonly sample: (x: number, y: number) => Omit<TerrainCellDto, "x" | "y"> = (x, y) => terrainAt(seed, x, y)) {
    if (!Number.isInteger(size) || size < 1 || size > 64) throw new Error("Padding chunk size must be 1..64");
    this.residents = new Set([...resident].map(chunk => `${chunk.chunkX},${chunk.chunkY}`));
  }
  getPartial(x: number, y: number, cells: readonly Cell[]): { terrain: TerrainCellDto[]; kindAt: PaddingTerrainMaterial["kindAt"] } | undefined {
    if (cells.length > this.size * this.size || cells.some(cell => !Number.isSafeInteger(cell.x) || !Number.isSafeInteger(cell.y)
      || cell.x < x * this.size || cell.x >= (x + 1) * this.size || cell.y < y * this.size || cell.y >= (y + 1) * this.size)) {
      throw new Error("Partial terrain cells must belong to their bounded chunk");
    }
    const capture = this.capture(x, y); if (!capture) return undefined;
    const terrain = cells.map(cell => {
      const value = capture.cellAt(cell.x, cell.y);
      capture.cellAt(cell.x - 1, cell.y); capture.cellAt(cell.x + 1, cell.y);
      capture.cellAt(cell.x, cell.y - 1); capture.cellAt(cell.x, cell.y + 1);
      return value;
    });
    return { terrain, kindAt: capture.kindAt };
  }
  private capture(x: number, y: number) {
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) throw new Error("Invalid padding chunk coordinate");
    const id = `${x},${y}`;
    if (this.residents.has(id)) return undefined;
    const cached = this.captures.get(id);
    if (cached) return cached;
    const originX = x * this.size, originY = y * this.size, stride = this.size + 2;
    const kinds = new Array<AtlasTerrainKind | undefined>(stride * stride);
    const samples = new Array<TerrainCellDto | undefined>(stride * stride);
    const capture = {
      cellAt: (column: number, row: number) => {
        const index = (row - originY + 1) * stride + column - originX + 1;
        let value = samples[index];
        if (!value) {
          value = { x: column, y: row, ...this.sample(column, row) };
          samples[index] = value; kinds[index] = atlasTerrainKindFromWorld(value.terrain);
        }
        return value;
      },
      kindAt: (column: number, row: number) => {
        const localX = column - originX + 1, localY = row - originY + 1;
        return localX >= 0 && localX < stride && localY >= 0 && localY < stride ? kinds[localY * stride + localX] : undefined;
      },
    };
    this.captures.set(id, capture); return capture;
  }
  get(x: number, y: number): PaddingTerrainMaterial | undefined {
    const capture = this.capture(x, y); if (!capture) return undefined;
    const id = `${x},${y}`, cached = this.cache.get(id); if (cached) return cached;
    const originX = x * this.size, originY = y * this.size, terrain: TerrainCellDto[] = [];
    for (let row = originY; row < originY + this.size; row++) {
      capture.cellAt(originX - 1, row);
      for (let column = originX; column < originX + this.size; column++) terrain.push(capture.cellAt(column, row));
      capture.cellAt(originX + this.size, row);
    }
    for (let column = originX; column < originX + this.size; column++) {
      capture.cellAt(column, originY - 1); capture.cellAt(column, originY + this.size);
    }
    const material: PaddingTerrainMaterial = { chunk: { chunkX: x, chunkY: y, size: this.size, terrain },
      kindAt: capture.kindAt };
    this.cache.set(id, material);
    return material;
  }
  retain(coordinates: readonly (readonly [number, number])[]): void {
    const wanted = new Set(coordinates.map(([x, y]) => `${x},${y}`));
    for (const id of this.cache.keys()) if (!wanted.has(id)) this.cache.delete(id);
    for (const id of this.captures.keys()) if (!wanted.has(id)) this.captures.delete(id);
  }
  get cachedChunks(): number { return this.captures.size; }
}
