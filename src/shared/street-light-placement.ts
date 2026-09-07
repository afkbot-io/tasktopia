import type { Cell, SurfaceCellDto, TerrainKind } from "./contracts";

const key = (c: Cell) => `${c.x},${c.y}`;
const directions = [{ x:0,y:-1 },{ x:1,y:0 },{ x:0,y:1 },{ x:-1,y:0 }];
const mod = (n: number) => ((n % 8) + 8) % 8;

/** Fixed eight-cell street rhythm on the verge, never in the walking lane.
 * Context includes the four-cell surface/obstacle halo; origins stay local.
 * No random density roll, chunk-local counter or greedy traversal state.
 */
export function streetLightOrigins(seed: number, origins: readonly Cell[], surfaces: readonly SurfaceCellDto[],
  blocked: ReadonlySet<string>, ground: (cell: Cell) => TerrainKind | undefined): Cell[] {
  const paving = new Map(surfaces.map(c => [key(c),c.kind]));
  const eligible = (cell: Cell) => {
    if (blocked.has(key(cell)) || paving.has(key(cell)) || !["GRASS","MEADOW","DIRT"].includes(ground(cell) ?? "")) return false;
    const edges = directions.filter(d => {
      const kind = paving.get(key({ x: cell.x + d.x, y: cell.y + d.y }));
      return kind === "SIDEWALK" || kind === "PATH";
    });
    if (edges.length !== 1) return false;
    const edge = edges[0]!;
    const along = edge.y ? cell.x : cell.y;
    // Opposite verges are staggered by half a period.
    if (mod(along - seed - (edge.x + edge.y > 0 ? 4 : 0)) !== 0) return false;
    for (let y=-2;y<=2;y++) for(let x=-2;x<=2;x++) {
      if (paving.get(key({x:cell.x+x,y:cell.y+y})) === "CROSSWALK") return false;
    }
    return true;
  };
  return origins.filter(cell => {
    if (!eligible(cell)) return false;
    // At a turn, retain one deterministic candidate rather than two touching
    // lamp sprites. Neighbour decisions use the same global context.
    for(let y=-2;y<=2;y++) for(let x=-2;x<=2;x++) {
      if (y>0 || y===0 && x>=0) continue;
      if (eligible({x:cell.x+x,y:cell.y+y})) return false;
    }
    return true;
  }).map(({x,y}) => ({x,y}));
}
