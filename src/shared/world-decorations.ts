import type {
  Cell,
  DecorationDto,
  DistrictArchetype,
  DistrictStatus,
  Rect,
  SurfaceCellDto,
  TerrainCellDto,
  TaskDto,
} from "./contracts";
import { hashCoordinate, isWater } from "./world-terrain";

type DecorationDistrict = {
  id: string;
  status: DistrictStatus;
  archetype: DistrictArchetype;
  cells: Cell[];
};

type DecorationTask = Pick<TaskDto, "id" | "taskNumber" | "visualKind" | "stage" | "footprint" | "accessPath">;

const DIRECTIONS = [
  { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 },
] as const;

function key(cell: Cell): string { return `${cell.x},${cell.y}`; }
function contains(bounds: Rect, cell: Cell): boolean {
  return cell.x >= bounds.minX && cell.x <= bounds.maxX && cell.y >= bounds.minY && cell.y <= bounds.maxY;
}
function expand(bounds: Rect, margin: number): Rect {
  return { minX: bounds.minX - margin, minY: bounds.minY - margin, maxX: bounds.maxX + margin, maxY: bounds.maxY + margin };
}
function neighbors(cell: Cell): Cell[] { return DIRECTIONS.map((direction) => ({ x: cell.x + direction.x, y: cell.y + direction.y })); }
function manhattan(a: Cell, b: Cell): number { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
function footprint(origin: Cell, width: number, height: number): Cell[] {
  return Array.from({ length: width * height }, (_, index) => ({ x: origin.x + index % width, y: origin.y + Math.floor(index / width) }));
}

type SeededNaturePatch = "SHRUB" | "ROCK";

/**
 * Macro-cell patches are evaluated from world coordinates, not chunk-local
 * iteration state. Adjacent chunks therefore reproduce the same field edge.
 * A patch is a composition rule; the backend never stores its cells.
 */
function seededNaturePatch(seed: number, cell: Cell): SeededNaturePatch | undefined {
  const macroSize = 32;
  const macroX = Math.floor(cell.x / macroSize);
  const macroY = Math.floor(cell.y / macroSize);
  const localX = cell.x - macroX * macroSize;
  const localY = cell.y - macroY * macroSize;
  const roll = hashCoordinate(seed, macroX, macroY, 881);
  const patch: SeededNaturePatch | undefined = roll < 0.18 ? "SHRUB"
    : roll < 0.24 ? "ROCK" : undefined;
  if (!patch) return undefined;
  const centerX = 12 + Math.floor(hashCoordinate(seed, macroX, macroY, 883) * 8);
  const centerY = 12 + Math.floor(hashCoordinate(seed, macroX, macroY, 887) * 8);
  const dx = localX - centerX;
  const dy = localY - centerY;
  const radius = patch === "SHRUB" ? 6 : 4;
  const inside = dx * dx + dy * dy <= radius * radius;
  const density = patch === "SHRUB" ? 0.68 : 0.52;
  return inside && hashCoordinate(seed, cell.x, cell.y, 919) < density ? patch : undefined;
}

// Keep the deterministic generator independent from the asset manifest. The
// worker needs geometry only; importing the full catalog duplicated hundreds
// of kilobytes of sprite metadata in its bundle.
function decorationFootprint(kind: string): { width: number; height: number } {
  if (kind.startsWith("boat-horizontal-")) return { width: 3, height: 1 };
  if (kind.startsWith("boat-vertical-")) return { width: 1, height: 3 };
  if (kind === "fence-horizontal" || kind === "bench-horizontal" || kind === "streetlamp-double") return { width: 2, height: 1 };
  if (kind === "fence-vertical") return { width: 1, height: 2 };
  if (kind === "hill-rocky" || kind === "hill-small") return { width: 2, height: 2 };
  if (kind === "mountain-peak") return { width: 2, height: 3 };
  if (kind === "mountain-ridge") return { width: 3, height: 2 };
  return { width: 1, height: 1 };
}

export function generateWorldDecorations(
  seed: number,
  terrain: TerrainCellDto[],
  blocked: Set<string>,
  surfaces: SurfaceCellDto[],
  districts: DecorationDistrict[],
  cityBounds: Rect[],
  tasks: DecorationTask[],
): DecorationDto[] {
  const result: DecorationDto[] = [];
  const ambientCounts = { boats: 0, fishers: 0 };
  const occupied = new Set(blocked);
  const terrainByCell = new Map(terrain.map((cell) => [key(cell), cell]));
  const surfaceKeys = new Set(surfaces.map(key));
  const districtByCell = new Map(districts.flatMap((district) => district.cells.map((cell) => [key(cell), district] as const)));
  const districtCellKeys = new Map(districts.map((district) => [district.id, new Set(district.cells.map(key))]));
  const cityRanges = new Map([24, 72, 96].map((margin) => [margin, cityBounds.map((bounds) => expand(bounds, margin))]));
  const closeToCity = (cell: Cell, margin = 72) => (cityRanges.get(margin) ?? []).some((bounds) => contains(bounds, cell));
  const adjacentToSurface = (cell: Cell) => neighbors(cell).some((neighbor) => surfaceKeys.has(key(neighbor)));
  const closeToBlocked = (cell: Cell, distance: number) => {
    for (let dy = -distance; dy <= distance; dy += 1) for (let dx = -distance; dx <= distance; dx += 1) {
      if (Math.abs(dx) + Math.abs(dy) <= distance && blocked.has(key({ x: cell.x + dx, y: cell.y + dy }))) return true;
    }
    return false;
  };
  const waterDirection = (cell: Cell): "north" | "east" | "south" | "west" | undefined => {
    const names = ["north", "east", "south", "west"] as const;
    for (let distance = 1; distance <= 4; distance += 1) for (let index = 0; index < DIRECTIONS.length; index += 1) {
      const direction = DIRECTIONS[index]!;
      const nearby = terrainByCell.get(key({ x: cell.x + direction.x * distance, y: cell.y + direction.y * distance }));
      if (nearby && isWater(nearby.terrain)) return names[index];
    }
    return undefined;
  };

  for (const cell of terrain) {
    if (occupied.has(key(cell))) continue;
    const chance = hashCoordinate(seed, cell.x, cell.y, 701);
    let kind: string | undefined;
    let clearance = 0;
    const district = districtByCell.get(key(cell));
    const shoreDirection = (cell.terrain === "SAND" || cell.terrain === "WET_SAND") && closeToCity(cell) ? waterDirection(cell) : undefined;
    const naturePatch = !district && (cell.terrain === "GRASS" || cell.terrain === "MEADOW") && !closeToCity(cell, 24)
      ? seededNaturePatch(seed, cell) : undefined;
    if (naturePatch === "SHRUB") {
      const shrubs = ["shrub-hazel", "shrub-fern", "shrub-flowering", "shrub-hedge", "shrub-juniper"];
      kind = shrubs[Math.floor(hashCoordinate(seed, cell.x, cell.y, 941) * shrubs.length)];
    } else if (naturePatch === "ROCK") {
      kind = hashCoordinate(seed, cell.x, cell.y, 947) < 0.72 ? "rock-small" : "rock-cluster";
    } else if (cell.terrain === "DEEP_WATER" && closeToCity(cell, 96) && ambientCounts.boats < 3 && chance < 0.0005) {
      const horizontal = hashCoordinate(seed, cell.x, cell.y, 719) < 0.5;
      kind = `boat-${horizontal ? "horizontal" : "vertical"}-${hashCoordinate(seed, cell.x, cell.y, 727) < 0.5 ? "a" : "b"}`;
    } else if (shoreDirection && !closeToBlocked(cell, 1) && ambientCounts.fishers < 2 && chance < 0.0028) {
      kind = `fisher-${shoreDirection}`;
    } else if ((cell.terrain === "GRASS" || cell.terrain === "MEADOW") && closeToCity(cell, 24) && adjacentToSurface(cell) && chance < 0.01) {
      const lampByArchetype: Record<DistrictArchetype, string> = {
        PRIVATE: "streetlamp-vintage", NEW_BUILD: "streetlamp-modern", MIXED_URBAN: "streetlamp-double",
        CIVIC: "streetlamp-solar", COMMERCIAL: "streetlamp-industrial",
      };
      kind = lampByArchetype[district?.archetype ?? "MIXED_URBAN"];
    } else if (district && district.status !== "ACTIVE" && (cell.terrain === "GRASS" || cell.terrain === "MEADOW") && chance < 0.006) {
      const own = districtCellKeys.get(district.id)!;
      const edge = DIRECTIONS.findIndex((direction) => !own.has(key({ x: cell.x + direction.x, y: cell.y + direction.y })));
      if (edge >= 0) kind = edge % 2 === 0 ? "fence-horizontal" : "fence-vertical";
    } else if (cell.terrain === "FOREST" && chance < 0.17) {
      const forestTrees = ["tree-conifer", "tree-round", "tree-birch", "tree-pine", "tree-oak", "tree-cherry", "tree-maple", "tree-cedar", "tree-aspen", "tree-redwood", "tree-deadwood"];
      kind = forestTrees[Math.floor(hashCoordinate(seed, cell.x, cell.y, 739) * forestTrees.length)];
    } else if (cell.terrain === "HILL" && chance < 0.085) {
      kind = chance < 0.035 ? "hill-rocky" : chance < 0.06 ? "hill-small" : "tree-pine";
    } else if (cell.terrain === "MOUNTAIN" && chance < 0.075) {
      kind = chance < 0.03 ? "mountain-peak" : chance < 0.052 ? "mountain-ridge" : "rock-cluster";
    } else if ((cell.terrain === "GRASS" || cell.terrain === "MEADOW") && chance < 0.016) {
      const variants = ["flower-white", "flower-yellow", "flower-red", "flower-purple"];
      kind = variants[Math.floor(hashCoordinate(seed, cell.x, cell.y, 709) * variants.length)];
    } else if (cell.terrain === "STONE" && chance < 0.035) kind = chance < 0.017 ? "rock-small" : "rock-cluster";
    else if (cell.terrain === "SHALLOW_WATER" && chance < 0.02) kind = chance < 0.01 ? "reed-green" : "reed-cattail";

    if (!kind) continue;
    const dimensions = decorationFootprint(kind);
    const parts = footprint(cell, dimensions.width, dimensions.height);
    const ownDistrict = district ? districtCellKeys.get(district.id) : undefined;
    const valid = parts.every((part) => {
      const terrainCell = terrainByCell.get(key(part));
      if (!terrainCell || occupied.has(key(part))) return false;
      if (kind!.startsWith("boat-") && terrainCell.terrain !== "DEEP_WATER") return false;
      if (kind!.startsWith("fisher-") && terrainCell.terrain !== "SAND" && terrainCell.terrain !== "WET_SAND") return false;
      if (kind!.startsWith("fence-") && !ownDistrict?.has(key(part))) return false;
      return true;
    });
    if (!valid) continue;
    const landform = kind.startsWith("hill-") || kind.startsWith("mountain-");
    clearance = landform ? 2 : clearance;
    let available = true;
    for (const part of parts) {
      for (let dy = -clearance; dy <= clearance && available; dy += 1) for (let dx = -clearance; dx <= clearance; dx += 1) {
        if (occupied.has(key({ x: part.x + dx, y: part.y + dy }))) { available = false; break; }
        if (landform && (dx !== 0 || dy !== 0) && hashCoordinate(seed, part.x + dx, part.y + dy, 701) < chance) { available = false; break; }
      }
      if (!available) break;
    }
    if (!available) continue;
    result.push({ id: `${kind}:${cell.x}:${cell.y}`, kind, origin: { x: cell.x, y: cell.y } });
    if (kind.startsWith("boat-")) ambientCounts.boats += 1;
    else if (kind.startsWith("fisher-")) ambientCounts.fishers += 1;
    for (const part of parts) for (let dy = -clearance; dy <= clearance; dy += 1) for (let dx = -clearance; dx <= clearance; dx += 1) {
      occupied.add(key({ x: part.x + dx, y: part.y + dy }));
    }
  }

  const taskAccess = new Set(tasks.flatMap((task) => task.accessPath).map(key));
  const taskFootprints = new Set(tasks.flatMap((task) => task.footprint).map(key));
  const streetTrees = ["tree-oak", "tree-maple", "tree-round", "tree-aspen", "tree-birch", "tree-apple", "tree-cherry", "tree-magnolia"];
  const streetTreeCells: Cell[] = [];
  const frontageOccupied = new Set(result.flatMap((decoration) => {
    const dimensions = decorationFootprint(decoration.kind);
    return footprint(decoration.origin, dimensions.width, dimensions.height).map(key);
  }));
  for (const task of tasks) {
    if (task.visualKind !== "BUILDING" || task.stage < 3 || task.footprint.length < 20) continue;
    const own = new Set(task.footprint.map(key));
    const candidates = [...new Map(task.footprint.flatMap(neighbors).map((cell) => [key(cell), cell])).values()]
      .filter((cell) => !own.has(key(cell)) && surfaceKeys.has(key(cell)) && !taskAccess.has(key(cell)) && terrainByCell.has(key(cell)))
      .sort((left, right) => hashCoordinate(seed + task.taskNumber, left.x, left.y, 751)
        - hashCoordinate(seed + task.taskNumber, right.x, right.y, 751));
    const target = task.footprint.length >= 150 ? 4 : task.footprint.length >= 80 ? 3 : 2;
    let placed = 0;
    for (const cell of candidates) {
      if (placed >= target) break;
      const pick = hashCoordinate(seed + task.taskNumber, cell.x, cell.y, 757);
      const kind = placed === 1
        ? (target === 2 && pick >= 0.5 ? "trash-bin" : "bench-horizontal")
        : placed === 2 ? "trash-bin"
          : streetTrees[Math.floor(pick * streetTrees.length) % streetTrees.length]!;
      const dimensions = decorationFootprint(kind);
      const parts = footprint(cell, dimensions.width, dimensions.height);
      if (!parts.every((part) => surfaceKeys.has(key(part))
        && terrainByCell.has(key(part))
        && !taskAccess.has(key(part))
        && !taskFootprints.has(key(part))
        && !frontageOccupied.has(key(part)))) continue;
      if (kind.startsWith("tree-") && streetTreeCells.some((tree) => manhattan(tree, cell) < 3)) continue;
      result.push({ id: `frontage:${task.id}:${cell.x}:${cell.y}`, kind, origin: cell });
      for (const part of parts) {
        occupied.add(key(part));
        frontageOccupied.add(key(part));
      }
      if (kind.startsWith("tree-")) streetTreeCells.push(cell);
      placed += 1;
    }
  }
  return result;
}
