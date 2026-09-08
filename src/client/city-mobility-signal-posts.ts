import type { Cell, TerrainKind } from "../shared/contracts";

export type CityMobilitySignalPost = {
  /** Stable signal/approach identity, independent of the selected display cell. */
  id: string;
  origin: Cell;
  axis: "H" | "V";
  approach: "N" | "E" | "S" | "W";
};
type CellMembership = Pick<ReadonlySet<string>, "has">;
export type CityMobilitySignalPostInput<T extends CityMobilitySignalPost = CityMobilitySignalPost> = {
  posts: readonly T[];
  terrain: ReadonlyMap<string, { terrain: TerrainKind }>;
  roads: CellMembership;
  walkGraph: CellMembership;
  /** Includes building/prop footprints, construction clearance and drawn water. */
  blocked: CellMembership;
};

const DRY_GROUND = new Set<TerrainKind>(["GRASS", "MEADOW", "DIRT", "SAND"]);
// The network producer assigns N/E/S/W to its NW/NE/SE/SW curb corners.
// Search only outward in that quadrant, at most two Manhattan cells away;
// first prefer displacement along the corresponding traffic approach.
const OUTWARD_OFFSETS: Record<CityMobilitySignalPost["approach"], readonly (readonly [number, number])[]> = {
  N: [[0, 0], [0, -1], [-1, 0], [0, -2], [-1, -1], [-2, 0]],
  E: [[0, 0], [1, 0], [0, -1], [2, 0], [1, -1], [0, -2]],
  S: [[0, 0], [0, 1], [1, 0], [0, 2], [1, 1], [2, 0]],
  W: [[0, 0], [-1, 0], [0, 1], [-2, 0], [-1, 1], [0, 2]],
};

/**
 * Place the current 1×1-cell physical post support without changing any graph.
 * Call when geography is reconciled, not per animation frame. Missing terrain
 * is not safe terrain. Omitted posts retain their logical signal in the engine;
 * the caller must never render an unsafe fallback at the original position.
 */
export function placeCityMobilitySignalPosts<T extends CityMobilitySignalPost>(input: CityMobilitySignalPostInput<T>): T[] {
  const placed: T[] = [];
  const occupied = new Set<string>();
  const claimed = new Set<string>();
  for (const post of [...input.posts].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    const intended = `${post.origin.x},${post.origin.y}`;
    if (claimed.has(intended)) continue;
    if (!Number.isSafeInteger(post.origin.x) || !Number.isSafeInteger(post.origin.y)) continue;
    for (const [dx, dy] of OUTWARD_OFFSETS[post.approach]) {
      const origin = { x: post.origin.x + dx, y: post.origin.y + dy };
      const cellKey = `${origin.x},${origin.y}`;
      const terrain = input.terrain.get(cellKey)?.terrain;
      const besideRoad = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([x, y]) => input.roads.has(`${origin.x + x!},${origin.y + y!}`));
      if (!besideRoad || !terrain || !DRY_GROUND.has(terrain) || occupied.has(cellKey)
        || input.roads.has(cellKey) || input.blocked.has(cellKey)) continue;
      placed.push({ ...post, origin });
      occupied.add(cellKey);
      claimed.add(intended);
      break;
    }
  }
  return placed;
}
