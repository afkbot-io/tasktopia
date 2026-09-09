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
import { compactTreeCandidate, compactTreeCover } from "./compact-tree-placement";
import { streetLightOrigins } from "./street-light-placement";
import { courtyardFurnitureFootprint, type CourtyardFurnitureKind } from "./courtyard-furniture";

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

const FOREST_TREE_SPECIES = [
  "tree-conifer", "tree-pine", "tree-cedar", "tree-oak", "tree-round",
  "tree-birch", "tree-aspen", "tree-redwood", "tree-maple", "tree-cherry",
  "tree-cypress",
] as const;

/** Pick one species from a jittered world-space grove, stable across chunks. */
function forestGrove(seed: number, cell: Cell): { species: string; density: number } {
  const size = 14;
  const macroX = Math.floor(cell.x / size);
  const macroY = Math.floor(cell.y / size);
  let selectedX = macroX;
  let selectedY = macroY;
  let nearest = Number.POSITIVE_INFINITY;
  for (let y = macroY - 1; y <= macroY + 1; y += 1) for (let x = macroX - 1; x <= macroX + 1; x += 1) {
    const centerX = x * size + 3 + Math.floor(hashCoordinate(seed, x, y, 731) * (size - 6));
    const centerY = y * size + 3 + Math.floor(hashCoordinate(seed, x, y, 733) * (size - 6));
    const dx = cell.x - centerX;
    const dy = cell.y - centerY;
    const distance = dx * dx + dy * dy;
    if (distance < nearest) {
      nearest = distance;
      selectedX = x;
      selectedY = y;
    }
  }
  const pick = hashCoordinate(seed, selectedX, selectedY, 737);
  const clearing = hashCoordinate(seed, selectedX, selectedY, 761) < 0.12;
  const core = Math.max(0, 1 - nearest / 150);
  return {
    species: FOREST_TREE_SPECIES[Math.floor(pick * FOREST_TREE_SPECIES.length)]!,
    density: Math.min(1, 0.10 + core * (0.82 + hashCoordinate(seed, selectedX, selectedY, 739) * 0.18))
      * (clearing ? 0.08 : 1),
  };
}

// Keep the deterministic generator independent from the asset manifest. The
// worker needs geometry only; importing the full catalog duplicated hundreds
// of kilobytes of sprite metadata in its bundle.
function decorationFootprint(kind: string): { width: number; height: number } {
  const courtyard = courtyardFurnitureFootprint(kind);
  if (courtyard) return courtyard;
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
  terrainContext: TerrainCellDto[] = terrain,
  sampleTerrain?: (cell: Cell) => TerrainCellDto["terrain"],
  furnitureExclusions?: ReadonlySet<string>,
): DecorationDto[] {
  const result: DecorationDto[] = [];
  const spawnOrigins = new Set(terrain.map(key));
  const ambientCounts = { boats: 0 };
  const occupied = new Set(blocked);
  const terrainByCell = new Map(terrainContext.map((cell) => [key(cell), cell]));
  const surfaceKeys = new Set(surfaces.map(key));
  const taskAccess = new Set(tasks.flatMap((task) => task.accessPath).map(key));
  const taskFootprints = new Set(tasks.flatMap((task) => task.footprint).map(key));
  const furniturePaving = new Set(surfaces.filter(cell => cell.kind === "SIDEWALK"
    || cell.kind === "PATH" && cell.finish === "PAVERS").map(key));
  const courtyardReserved = new Set<string>();
  const courtyardByTask = new Map<string, DecorationDto>();
  // Select one permanent furniture position before lamps/natural crowns.
  // Geometry does not depend on stage: unfinished tasks reserve but don't show it.
  for (const task of [...tasks].sort((a, b) => a.taskNumber - b.taskNumber || a.id.localeCompare(b.id))) {
    if (task.visualKind !== "BUILDING" || task.footprint.length < 18) continue;
    const own = new Set(task.footprint.map(key));
    const preferredWidth = task.footprint.length >= 36 ? 2 : 1;
    const maxX = Math.max(...task.footprint.map(cell => cell.x));
    // This one anchor is chosen from complete task geometry, not a chunk's
    // truncated paving halo. An unavailable anchor is skipped, never replaced
    // by a second local choice on the other side of the same chunk boundary.
    const candidates = task.footprint.map(cell => ({ x: cell.x, y: cell.y + 1 }))
      .filter(cell => !own.has(key(cell)) && cell.x + preferredWidth - 1 <= maxX
        && footprint(cell, preferredWidth, 1).every(part => !taskFootprints.has(key(part)) && !taskAccess.has(key(part))))
      .sort((a, b) => hashCoordinate(seed + task.taskNumber, a.x, a.y, 787)
        - hashCoordinate(seed + task.taskNumber, b.x, b.y, 787) || a.y - b.y || a.x - b.x);
    const origin = candidates[0];
    if (!origin) continue;
    const kinds: CourtyardFurnitureKind[] = task.footprint.length >= 80
      ? ["courtyard-picnic-table", "courtyard-cycle-rack", "courtyard-square-planter"]
      : task.footprint.length >= 36 ? ["courtyard-cycle-rack", "courtyard-square-planter"] : ["courtyard-square-planter"];
    for (const kind of kinds) {
      const dimensions = decorationFootprint(kind);
      const available = footprint(origin, dimensions.width, dimensions.height).every(part =>
        furniturePaving.has(key(part)) && terrainByCell.has(key(part))
        && !isWater(terrainByCell.get(key(part))!.terrain)
        && !furnitureExclusions?.has(key(part)) && !taskFootprints.has(key(part))
        && !taskAccess.has(key(part)) && !courtyardReserved.has(key(part)));
      if (!available) continue;
      const decoration = { id: `frontage:${task.id}:${origin.x}:${origin.y}`, kind, origin };
      courtyardByTask.set(task.id, decoration);
      for (const part of footprint(origin, dimensions.width, dimensions.height)) {
        courtyardReserved.add(key(part)); occupied.add(key(part));
      }
      if (task.stage === 5 && spawnOrigins.has(key(origin))) result.push(decoration);
      break;
    }
  }
  const districtByCell = new Map(districts.flatMap((district) => district.cells.map((cell) => [key(cell), district] as const)));
  const districtCellKeys = new Map(districts.map((district) => [district.id, new Set(district.cells.map(key))]));
  const cityRanges = new Map([24, 72, 96].map((margin) => [margin, cityBounds.map((bounds) => expand(bounds, margin))]));
  const closeToCity = (cell: Cell, margin = 72) => (cityRanges.get(margin) ?? []).some((bounds) => contains(bounds, cell));
  const closeToBlocked = (cell: Cell, distance: number) => {
    for (let dy = -distance; dy <= distance; dy += 1) for (let dx = -distance; dx <= distance; dx += 1) {
      if (Math.abs(dx) + Math.abs(dy) <= distance && blocked.has(key({ x: cell.x + dx, y: cell.y + dy }))) return true;
    }
    return false;
  };
  const waterDirection = (cell: Cell, maximumDistance = 4): "north" | "east" | "south" | "west" | undefined => {
    const names = ["north", "east", "south", "west"] as const;
    for (let distance = 1; distance <= maximumDistance; distance += 1) for (let index = 0; index < DIRECTIONS.length; index += 1) {
      const direction = DIRECTIONS[index]!;
      const point = { x: cell.x + direction.x * distance, y: cell.y + direction.y * distance };
      let nearby = terrainByCell.get(key(point));
      // Crown clearance needs only two cells, but rare shore species inspect
      // up to ten. Resolve missing samples lazily; never expand spawn origins
      // or request neighbouring chunks just to decide a palm/willow species.
      if (!nearby && sampleTerrain) {
        nearby = { ...point, terrain: sampleTerrain(point), variant: 0 };
        terrainByCell.set(key(point), nearby);
      }
      if (nearby && isWater(nearby.terrain)) return names[index];
    }
    return undefined;
  };

  const lampObstacles = new Set(blocked);
  for (const cell of courtyardReserved) lampObstacles.add(cell);
  for (const task of tasks) {
    for (const cell of [...task.footprint,...task.accessPath]) lampObstacles.add(key(cell));
    if (task.stage < 5) for (const cell of task.footprint) for (const neighbour of neighbors(cell)) lampObstacles.add(key(neighbour));
  }
  const lampKinds: Record<DistrictArchetype, string> = {
    PRIVATE:"streetlamp-vintage", NEW_BUILD:"streetlamp-modern", MIXED_URBAN:"streetlamp",
    CIVIC:"streetlamp-solar", COMMERCIAL:"streetlamp-industrial",
  };
  const lampCover = new Set<string>();
  for (const cell of streetLightOrigins(seed, terrainContext, surfaces, lampObstacles,
    cell => terrainByCell.get(key(cell))?.terrain ?? sampleTerrain?.(cell))) {
    const kind = lampKinds[districtByCell.get(key(cell))?.archetype ?? "MIXED_URBAN"];
    if (spawnOrigins.has(key(cell))) result.push({ id:`${kind}:${cell.x}:${cell.y}`, kind, origin:cell });
    occupied.add(key(cell));
    lampCover.add(key(cell)); lampCover.add(key({ x:cell.x,y:cell.y-1 }));
  }
  for (const cell of terrain) {
    if (occupied.has(key(cell))) continue;
    const chance = hashCoordinate(seed, cell.x, cell.y, 701);
    let kind: string | undefined;
    let clearance = 0;
    const district = districtByCell.get(key(cell));
    const palmCandidate = !district && cell.terrain === "SAND"
      && hashCoordinate(seed, cell.x, cell.y, 751) < 0.018;
    const willowCandidate = !district && (cell.terrain === "GRASS" || cell.terrain === "MEADOW")
      && hashCoordinate(seed, cell.x, cell.y, 757) < 0.012;
    const naturalShoreDirection = palmCandidate ? waterDirection(cell, 8)
      : willowCandidate ? waterDirection(cell, 10) : undefined;
    // Fine ground variation belongs to the deterministic material raster, not
    // thousands of independently sorted flower, stone and reed sprites.
    if (cell.terrain === "DEEP_WATER" && closeToCity(cell, 96) && ambientCounts.boats < 3 && chance < 0.0005) {
      const horizontal = hashCoordinate(seed, cell.x, cell.y, 719) < 0.5;
      kind = `boat-${horizontal ? "horizontal" : "vertical"}-${["a", "b", "c", "d"][Math.floor(hashCoordinate(seed, cell.x, cell.y, 727) * 4)]}`;
    } else if (palmCandidate && naturalShoreDirection && !closeToBlocked(cell, 1)) {
      kind = "tree-palm";
    } else if (willowCandidate && naturalShoreDirection && !closeToBlocked(cell, 1)) {
      kind = "tree-willow";
    } else if (district && district.status !== "ACTIVE" && (cell.terrain === "GRASS" || cell.terrain === "MEADOW") && chance < 0.006) {
      const own = districtCellKeys.get(district.id)!;
      const edge = DIRECTIONS.findIndex((direction) => !own.has(key({ x: cell.x + direction.x, y: cell.y + direction.y })));
      if (edge >= 0) kind = edge % 2 === 0 ? "fence-horizontal" : "fence-vertical";
    } else if (district && (cell.terrain === "GRASS" || cell.terrain === "MEADOW") && chance < .028) {
      const courtyardTrees = ["tree-oak", "tree-round", "tree-maple", "tree-cherry"];
      kind = courtyardTrees[Math.floor(hashCoordinate(seed, cell.x, cell.y, 747) * courtyardTrees.length)];
    } else if (cell.terrain === "FOREST") {
      const grove = forestGrove(seed, cell);
      if (chance < grove.density) kind = grove.species;
    } else if (cell.terrain === "HILL" && chance < 0.085) {
      kind = chance < 0.067 ? "tree-deadwood" : "tree-pine";
    } else if (cell.terrain === "MOUNTAIN" && chance < 0.052) {
      kind = chance < 0.03 ? "mountain-peak" : "mountain-ridge";
    } else if (!district && (cell.terrain === "GRASS" || cell.terrain === "MEADOW")
      && chance < (cell.terrain === "MEADOW" ? 0.005 : 0.003)) {
      const sparseTrees = ["tree-oak", "tree-round", "tree-birch", "tree-aspen", "tree-pine"];
      kind = sparseTrees[Math.floor(hashCoordinate(seed, cell.x, cell.y, 747) * sparseTrees.length)];
    }

    if (!kind) continue;
    if (kind.startsWith("tree-") && (!compactTreeCandidate(seed, cell, cell.terrain === "FOREST")
      || compactTreeCover(cell).some(part => blocked.has(key(part)) || lampCover.has(key(part)) || surfaceKeys.has(key(part))
        || isWater(terrainByCell.get(key(part))?.terrain ?? "GRASS")))) continue;
    const dimensions = decorationFootprint(kind);
    const parts = footprint(cell, dimensions.width, dimensions.height);
    const ownDistrict = district ? districtCellKeys.get(district.id) : undefined;
    const valid = parts.every((part) => {
      const terrainCell = terrainByCell.get(key(part));
      if (!terrainCell || occupied.has(key(part))) return false;
      if (kind!.startsWith("boat-") && terrainCell.terrain !== "DEEP_WATER") return false;
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
    for (const part of parts) for (let dy = -clearance; dy <= clearance; dy += 1) for (let dx = -clearance; dx <= clearance; dx += 1) {
      occupied.add(key({ x: part.x + dx, y: part.y + dy }));
    }
  }

  const streetTrees = ["tree-oak", "tree-maple", "tree-round", "tree-aspen", "tree-birch", "tree-apple", "tree-cherry", "tree-magnolia"];
  const streetTreeCells: Cell[] = [];
  const frontageOccupied = new Set([...courtyardReserved, ...result.flatMap((decoration) => {
    if (decoration.kind.startsWith("tree-")) return compactTreeCover(decoration.origin).map(key);
    const dimensions = decorationFootprint(decoration.kind);
    return footprint(decoration.origin, dimensions.width, dimensions.height).map(key);
  })]);
  for (const task of tasks) {
    if (task.visualKind !== "BUILDING" || task.stage < 3 || task.footprint.length < 18) continue;
    const own = new Set(task.footprint.map(key));
    const candidates = [...new Map(task.footprint.flatMap(neighbors).map((cell) => [key(cell), cell])).values()]
      .filter((cell) => !own.has(key(cell)) && surfaceKeys.has(key(cell)) && !taskAccess.has(key(cell)) && terrainByCell.has(key(cell)))
      .sort((left, right) => hashCoordinate(seed + task.taskNumber, left.x, left.y, 751)
        - hashCoordinate(seed + task.taskNumber, right.x, right.y, 751));
    const target = task.footprint.length >= 150 ? 4 : task.footprint.length >= 80 ? 3 : 2;
    const reservedFurniture = courtyardByTask.has(task.id);
    for (let role = 0; role < target - Number(reservedFurniture); role += 1) {
      const roomForTree = candidates.some(cell => compactTreeCover(cell).every(part => !taskFootprints.has(key(part))
        && !taskAccess.has(key(part)) && !frontageOccupied.has(key(part))
        && !(blocked.has(key(part)) && !surfaceKeys.has(key(part)))));
      for (const cell of candidates) {
        const pick = hashCoordinate(seed + task.taskNumber, cell.x, cell.y, 757);
        let kind = role === 1
          ? (target === 2 && pick >= 0.5 ? "trash-bin" : "bench-horizontal")
          : role === 2 ? "trash-bin"
            : streetTrees[Math.floor(pick * streetTrees.length) % streetTrees.length]!;
        // A compact 6x3 house often has only one paving cell in front. A low
        // planted pot fits there without letting a tree hide its facade/door.
        if (kind.startsWith("tree-") && !roomForTree) kind = reservedFurniture ? "trash-bin" : "planter-round";
        const dimensions = decorationFootprint(kind);
        const parts = footprint(cell, dimensions.width, dimensions.height);
        if (!parts.every((part) => surfaceKeys.has(key(part))
          && terrainByCell.has(key(part))
          && !taskAccess.has(key(part))
          && !taskFootprints.has(key(part))
          && !frontageOccupied.has(key(part)))) continue;
        if (kind.startsWith("tree-") && streetTreeCells.some((tree) => manhattan(tree, cell) < 3)) continue;
        const visibleCells = kind.startsWith("tree-") ? compactTreeCover(cell) : parts;
        if (visibleCells.some(part => taskFootprints.has(key(part)) || taskAccess.has(key(part))
          || frontageOccupied.has(key(part)) || blocked.has(key(part)) && !surfaceKeys.has(key(part)))) continue;
        result.push({ id: `frontage:${task.id}:${cell.x}:${cell.y}`, kind, origin: cell });
        for (const part of visibleCells) {
          occupied.add(key(part));
          frontageOccupied.add(key(part));
        }
        if (kind.startsWith("tree-")) streetTreeCells.push(cell);
        break;
      }
    }
  }
  return result.filter(item => spawnOrigins.has(key(item.origin)));
}
