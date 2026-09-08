import { createHash } from "node:crypto";
import { BLOCK_WORLD_GENERATOR_VERSION, type BlockServiceRole, type BlockSlotKind, type BlockWorldBounds, type CityBlockV1,
  type CompiledBlockLayoutV1, type ConstructionStage, type DistrictLayoutV1, type TaskPlacementV1 } from "../../shared/block-world";
import { BLOCK_MODULE_CELLS as MODULE, BLOCK_TEMPLATE_VERSION, blockSlots, blockTemplate, buildingBlockCandidates, createBlockSitePlan, type BlockSlot, type BlockTemplate } from "../../shared/block-templates";
import { COMPACT_BUILDING_SHAPES, compactBuildingServiceRole, compactBuildingShapeFamily, compactFamilyMatchesFootprint, compactHomeFamily, compactServiceFamily } from "../../shared/compact-building-families";
import { auditSemanticRoadNetwork, type SemanticRoadNetwork } from "../../shared/semantic-road";
export { rasterizeBlockRoads } from "../../shared/road-raster";
import { districtSeparatorBetween, overlapsDistrictSeparator, readDistrictSeparators, type DistrictSeparator } from "../../shared/district-separator";
import { cityLandmarkCandidates, isCityLandmark } from "../../shared/city-landmarks";

export type BlockLayoutTaskInput = {
  id: string; taskNumber: number; buildingFamily: string; facadeVariant: string;
  constructionStage: ConstructionStage; visualKind?: BlockSlotKind;
  autoVisualKind?: boolean;
  requestedFamily?: string;
  /** Task variant placement intent; persisted slot geometry remains immutable. */
  parkSize?: "POCKET" | "BLOCK";
  serviceRole?: BlockServiceRole;
  serviceTrigger?: string;
  serviceRoleAssigned?: boolean;
};
export type BlockLayoutDistrictInput = { id: string; archetype: string; sequence: number; tasks: BlockLayoutTaskInput[] };
export type BlockLayoutCompilerInput = {
  countryId: string; cityId: string; origin?: { x: number; y: number }; seed: number; revision: number;
  districts: BlockLayoutDistrictInput[]; previous?: CompiledBlockLayoutV1;
  canPlaceBlock?: (bounds: BlockWorldBounds) => boolean;
};

/** A valid plan has no remaining connected, buildable rectangle on its grid. */
export class BlockPlacementError extends Error {
  constructor(message: string) { super(message); this.name = "BlockPlacementError"; }
}

/** An explicit family must not bypass a stable mandatory infrastructure parcel. */
export class BlockReservationConflictError extends BlockPlacementError {
  constructor(message: string) { super(message); this.name = "BlockReservationConflictError"; }
}

export class UniqueBuildingConflictError extends BlockPlacementError {
  constructor(message: string) { super(message); this.name = "UniqueBuildingConflictError"; }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  return JSON.stringify(value);
}
function checksum(value: unknown): string { return createHash("sha256").update(canonicalJson(value)).digest("hex"); }
function deterministicId(namespace: string): string {
  const source = checksum(namespace).slice(0, 32).split(""); source[12] = "5"; source[16] = "8";
  const v = source.join(""); return `${v.slice(0, 8)}-${v.slice(8, 12)}-${v.slice(12, 16)}-${v.slice(16, 20)}-${v.slice(20)}`;
}
function assertCompilerInput(input: BlockLayoutCompilerInput): void {
  if (!input.countryId || !input.cityId) throw new Error("Block-v1 compiler requires country and city IDs");
  if (!Number.isSafeInteger(input.seed)) throw new Error("Block-v1 seed must be a safe integer");
  if (!Number.isSafeInteger(input.revision) || input.revision <= 0) throw new Error("Block-v1 revision must be positive");
  const origin = input.origin ?? { x: 0, y: 0 };
  if (!Number.isSafeInteger(origin.x) || !Number.isSafeInteger(origin.y)) throw new Error("Block-v1 origin must use integer cells");
  const districtIds = new Set<string>(); const sequences = new Set<number>(); const taskIds = new Set<string>();
  for (const district of input.districts) {
    if (!district.id || districtIds.has(district.id)) throw new Error(`Duplicate district: ${district.id}`);
    if (!Number.isSafeInteger(district.sequence) || district.sequence < 0 || sequences.has(district.sequence)) throw new Error("Invalid district sequence");
    districtIds.add(district.id); sequences.add(district.sequence);
    for (const task of district.tasks) {
      if (!task.id || taskIds.has(task.id)) throw new Error(`Duplicate task: ${task.id}`);
      taskIds.add(task.id);
      if (!Number.isInteger(task.constructionStage) || task.constructionStage < 1 || task.constructionStage > 5) throw new Error(`Invalid construction stage for ${task.id}`);
      if (!Number.isSafeInteger(task.taskNumber) || task.taskNumber < 1) throw new Error(`Invalid task number for ${task.id}`);
      if (task.visualKind && !["BUILDING", "PARK", "WATER", "PARKING"].includes(task.visualKind)) throw new Error(`Unknown slot kind for ${task.id}`);
      if (task.autoVisualKind !== undefined && typeof task.autoVisualKind !== "boolean") throw new Error(`Invalid automatic slot flag for ${task.id}`);
      if (task.parkSize !== undefined && (!["POCKET", "BLOCK"].includes(task.parkSize) || task.visualKind !== "PARK")) {
        throw new Error(`Invalid park size for ${task.id}`);
      }
      if (task.requestedFamily && (!compactBuildingShapeFamily(task.requestedFamily) || task.autoVisualKind
        || task.visualKind && task.visualKind !== "BUILDING")) throw new Error(`Invalid requested building family for ${task.id}`);
    }
  }
  if (input.previous && (input.previous.cityId !== input.cityId || input.previous.countryId !== input.countryId
    || input.previous.seed !== input.seed || input.previous.generatorVersion !== BLOCK_WORLD_GENERATOR_VERSION)) {
    throw new Error("Previous layout must belong to the same city, seed and generator");
  }
}
/** Reserve only the next already-planned building parcel; never invent a task or block. */
function reserveNextInfrastructure(district: BlockLayoutDistrictInput, ownBlocks: CityBlockV1[], allBlocks: CityBlockV1[],
  available: Array<{ block: CityBlockV1; slot: BlockSlot }>, occupied: Set<string>, placements: Iterable<TaskPlacementV1>, kinds: Map<string, BlockSlotKind>, durableTriggers: Set<string>, requestedFamily?: string): void {
  const slots = available.filter(({ block, slot }) => slot.kind === "BUILDING" && !occupied.has(`${block.id}:${slot.key}`));
  if (!slots.length || slots.some(({ block, slot }) => (block.parameters.slotRoles as Record<string, BlockServiceRole> | undefined)?.[slot.key])) return;
  const current = [...placements];
  const nonempty = new Set(current.map(p => p.blockId));
  const ownIds = new Set(ownBlocks.map(b => b.id));
  const count = current.filter(p => ownIds.has(p.blockId) && kinds.get(p.taskId) === "BUILDING").length;
  const triggers = new Set(allBlocks.flatMap(b => Object.values(b.parameters.slotRoleTriggers as Record<string, string> ?? {})));
  const pending: Array<{ id: string; role: BlockServiceRole }> = [];
  for (const [ordinal, role] of [[9, "EDUCATION"], [12, "MEDICAL"], [16, "FIRE"], [20, "POLICE"]] as const) {
    if (count >= ordinal - 1) pending.push({ id: `district:${district.id}:${role}:${ordinal}`, role });
  }
  const cityNonempty = allBlocks.filter(b => nonempty.has(b.id));
  if (cityNonempty.length >= 6) pending.push({ id: "city:RAILWAY:6", role: "RAILWAY" });
  if (new Set(cityNonempty.map(b => b.districtLayoutId)).size >= 3) pending.push({ id: "city:AIRPORT:3", role: "AIRPORT" });
  if (cityNonempty.length >= 18) pending.push({ id: "city:CIVIC:18", role: "CIVIC" });
  const ownNonempty = ownBlocks.filter(b => nonempty.has(b.id)).length;
  for (let n = 2; n <= ownNonempty; n += 2) pending.push({ id: `district:${district.id}:SHOP:${n}`, role: "SHOP" });
  const next = pending.find(p => !triggers.has(p.id) && !durableTriggers.has(p.id));
  if (!next) return;
  const candidates = requestedFamily ? slots.filter(({slot}) => familyFitsSlot(requestedFamily,slot)) : slots;
  // Art is a preference, never a reason to defer the next business service.
  const { block, slot } = candidates.find(({slot}) => serviceFamilyForSlot(next.role,slot)) ?? candidates[0] ?? slots[0]!;
  block.parameters = { ...block.parameters,
    slotRoles: { ...block.parameters.slotRoles as Record<string, BlockServiceRole>, [slot.key]: next.role },
    slotRoleTriggers: { ...block.parameters.slotRoleTriggers as Record<string, string>, [slot.key]: next.id } };
}

const familyFitsSlot = (family:string,slot:BlockSlot) => slot.kind === "BUILDING" && compactFamilyMatchesFootprint(family,
  slot.footprintBounds.maxX-slot.footprintBounds.minX+1,slot.footprintBounds.maxY-slot.footprintBounds.minY+1);
const serviceFamilyForSlot = (role:BlockServiceRole,slot:BlockSlot) => compactServiceFamily(role,
  slot.footprintBounds.maxX-slot.footprintBounds.minX+1,slot.footprintBounds.maxY-slot.footprintBounds.minY+1);
const parkSizeFitsSlot = (size: BlockLayoutTaskInput["parkSize"], slot: BlockSlot) => !size || slot.kind === "PARK"
  && slot.footprintBounds.maxX - slot.footprintBounds.minX + 1 >= (size === "BLOCK" ? 17 : 6)
  && slot.footprintBounds.maxY - slot.footprintBounds.minY + 1 >= (size === "BLOCK" ? 17 : 3);

function nextBlockSite(ownBlocks: CityBlockV1[], districtLayoutId: string, origin: { x: number; y: number }, kind: BlockSlotKind,
  sequence: number, canPlace: BlockLayoutCompilerInput["canPlaceBlock"], allBlocks: CityBlockV1[], parkSize?: BlockLayoutTaskInput["parkSize"], requestedFamily?: string) {
  const shapeKey = requestedFamily ? compactBuildingShapeFamily(requestedFamily) : undefined;
  if (requestedFamily && !shapeKey) throw new BlockPlacementError(`Unknown building geometry: ${requestedFamily}`);
  const templates = kind === "BUILDING"
    ? buildingBlockCandidates(sequence, shapeKey ? COMPACT_BUILDING_SHAPES[shapeKey] : undefined)
    : [blockTemplate(kind === "PARK" ? parkSize === "BLOCK" ? "park-grand" : "park-court" : kind === "WATER" ? "water-garden" : "parking-court")];
  if (!templates.length) throw new BlockPlacementError(`No block template fits building geometry: ${requestedFamily}`);
  let failure: BlockPlacementError | undefined;
  // A sprint owns tasks, not an exclusive rectangular territory. Keep its
  // usable local frontier first (including smaller compatible templates).
  // Only an exhausted local frontier may append a separate sprint-owned block
  // to the actual city street graph; it never relocates a previous parcel.
  const frontiers = ownBlocks.length ? [ownBlocks, allBlocks] : [allBlocks];
  // A new sprint gets a small reserved median where actual dry land allows it.
  // The compact fallback is important on a narrow coast: separation must never
  // manufacture a bridge or make an otherwise valid existing city unusable.
  const separationModes = !ownBlocks.length && allBlocks.length ? [true, false] : [false];
  for (const separated of separationModes) for (const frontier of frontiers) for (const template of templates) {
    try { return { template, ...nextBlockOrigin(frontier, districtLayoutId, origin, template, canPlace, allBlocks, separated) }; }
    catch (error) { if (!(error instanceof BlockPlacementError)) throw error; failure = error; }
  }
  throw failure!;
}

/** Compact edge-adjacent rectangle on the fixed city grid; only actual blocks reserve land. */
function nextBlockOrigin(frontierBlocks: CityBlockV1[], districtLayoutId: string, origin: { x: number; y: number }, template: BlockTemplate,
  canPlace: BlockLayoutCompilerInput["canPlaceBlock"], allBlocks: CityBlockV1[], separated: boolean): { origin: { x: number; y: number }; separator?: DistrictSeparator } {
  const occupied = new Set<string>(); const own = new Set<string>();
  const frontierIds = new Set(frontierBlocks.map(block => block.id));
  for (const block of allBlocks) {
    const bx = (block.origin.x - origin.x) / MODULE; const by = (block.origin.y - origin.y) / MODULE;
    const width = block.width / MODULE; const height = block.height / MODULE;
    if (!Number.isInteger(bx) || !Number.isInteger(by)) throw new Error(`Block outside district grid: ${block.id}`);
    for (let y = by; y < by + height; y += 1) for (let x = bx; x < bx + width; x += 1) {
      const key = `${x}:${y}`;
      if (occupied.has(key)) throw new Error(`Overlapping block: ${block.id}`);
      occupied.add(key);
      if (frontierIds.has(block.id)) own.add(key);
    }
  }
  const extent = allBlocks.reduce((b, block) => ({
    minX: Math.min(b.minX, block.origin.x), minY: Math.min(b.minY, block.origin.y),
    maxX: Math.max(b.maxX, block.origin.x + block.width), maxY: Math.max(b.maxY, block.origin.y + block.height),
  }), { minX: origin.x, minY: origin.y, maxX: origin.x, maxY: origin.y });
  // Search the finite edge frontier, not an expanding rectangle or an
  // arbitrarily clipped quadrant. Every candidate shares an existing street.
  const frontier = new Set<string>();
  for (const cell of own) {
    const [x, y] = cell.split(":").map(Number) as [number, number];
    for (let dy = 0; dy < template.heightModules; dy++) {
      frontier.add(`${x - template.widthModules - Number(separated)}:${y - dy}`);
      frontier.add(`${x + 1 + Number(separated)}:${y - dy}`);
    }
    for (let dx = 0; dx < template.widthModules; dx++) {
      frontier.add(`${x - dx}:${y - template.heightModules - Number(separated)}`);
      frontier.add(`${x - dx}:${y + 1 + Number(separated)}`);
    }
  }
  if (occupied.size === 0) frontier.add("0:0");
  const separators = readDistrictSeparators(allBlocks);
  const candidates: Array<{ x: number; y: number; dimension: number; area: number; distance: number; separator?: DistrictSeparator }> = [];
  for (const cell of frontier) {
    const [x, y] = cell.split(":").map(Number) as [number, number];
    let free = true;
    for (let dy = 0; dy < template.heightModules; dy += 1) for (let dx = 0; dx < template.widthModules; dx += 1) {
      if (occupied.has(`${x + dx}:${y + dy}`)) free = false;
    }
    if (!free) continue;
    const candidate = { x: origin.x + x * MODULE, y: origin.y + y * MODULE };
    const rectangle = { origin: candidate, width: template.widthModules * MODULE, height: template.heightModules * MODULE };
    if (separators.some(separator => overlapsDistrictSeparator(rectangle, separator))) continue;
    const separator = separated ? allBlocks.filter(b => b.districtLayoutId !== districtLayoutId)
      .map(b => districtSeparatorBetween(rectangle, b)).find(Boolean) : undefined;
    if (separated && !separator) continue;
    // Do not reserve a strip through a third, already occupied quarter.
    if (separator && allBlocks.some(b => overlapsDistrictSeparator(b, separator))) continue;
    const width = Math.max(extent.maxX, candidate.x + template.widthModules * MODULE) - Math.min(extent.minX, candidate.x);
    const height = Math.max(extent.maxY, candidate.y + template.heightModules * MODULE) - Math.min(extent.minY, candidate.y);
    candidates.push({ ...candidate, separator, dimension: Math.max(width, height), area: width * height, distance: Math.abs(x) + Math.abs(y) });
  }
  // Rank first, then ask the terrain predicate: checking every dry rectangle
  // would make task insertion scale with the entire explored terrain area.
  candidates.sort((a, b) => a.dimension - b.dimension || a.area - b.area || a.distance - b.distance || a.y - b.y || a.x - b.x);
  for (const candidate of candidates) {
    if (canPlace && !canPlace({ minX: candidate.x - 2, minY: candidate.y - 2,
      maxX: candidate.x + template.widthModules * MODULE + 2, maxY: candidate.y + template.heightModules * MODULE + 2 })) continue;
    if (canPlace && candidate.separator) {
      const b = candidate.separator.bounds;
      if (!canPlace({ minX: b.minX - 2, minY: b.minY - 2, maxX: b.maxX + 2, maxY: b.maxY + 2 })) continue;
    }
    return { origin: { x: candidate.x, y: candidate.y }, ...(candidate.separator ? { separator: candidate.separator } : {}) };
  }
  throw new BlockPlacementError("No buildable connected rectangle on the selected city frontier");
}

function compileRoadNetwork(blocks: CityBlockV1[], origin: { x: number; y: number }): SemanticRoadNetwork {
  const edges = new Map<string, { from: { x: number; y: number }; to: { x: number; y: number } }>();
  const edge = (x: number, y: number, horizontal: boolean) => edges.set(`${x}:${y}:${horizontal ? "E" : "S"}`,
    { from: { x, y }, to: { x: x + (horizontal ? MODULE : 0), y: y + (horizontal ? 0 : MODULE) } });
  // Empty cities have only their initial street. Every real block attaches
  // directly to the existing perimeter network, so no speculative spine is needed.
  if (blocks.length === 0) edge(origin.x, origin.y, true);
  for (const block of blocks) {
    for (let x = 0; x < block.width; x += MODULE) { edge(block.origin.x + x, block.origin.y, true); edge(block.origin.x + x, block.origin.y + block.height, true); }
    for (let y = 0; y < block.height; y += MODULE) { edge(block.origin.x, block.origin.y + y, false); edge(block.origin.x + block.width, block.origin.y + y, false); }
  }
  for (const { axis, bounds: b } of readDistrictSeparators(blocks)) {
    if (axis === "H") { edge(b.minX, b.minY, true); edge(b.minX, b.maxY, true); }
    else { edge(b.minX, b.minY, false); edge(b.maxX, b.minY, false); }
  }
  const points = new Map<string, { x: number; y: number }>(); const degree = new Map<string, number>();
  const segments = [...edges.values()].sort((a, b) => a.from.y - b.from.y || a.from.x - b.from.x || a.to.y - b.to.y).map(({ from, to }) => {
    const fromNodeId = `node:${from.x}:${from.y}`; const toNodeId = `node:${to.x}:${to.y}`;
    points.set(fromNodeId, from); points.set(toNodeId, to);
    for (const id of [fromNodeId, toNodeId]) degree.set(id, (degree.get(id) ?? 0) + 1);
    return { id: `edge:${from.x}:${from.y}:${to.x}:${to.y}`, fromNodeId, toNodeId, roadClass: "LOCAL" as const, widthCells: 3,
      geometry: { start: from, runs: [{ direction: from.y === to.y ? "E" as const : "S" as const, length: MODULE }] } };
  });
  return auditSemanticRoadNetwork({ schemaVersion: 1, segments,
    nodes: [...points].sort(([, a], [, b]) => a.y - b.y || a.x - b.x).map(([id, point]) => ({ id, ...point,
      kind: degree.get(id)! > 2 ? "JUNCTION" as const : degree.get(id) === 1 ? "TERMINUS" as const : "BOUNDARY" as const })) });
}

export function compileBlockLayout(input: BlockLayoutCompilerInput): CompiledBlockLayoutV1 {
  assertCompilerInput(input);
  const origin = input.origin ?? { x: 0, y: 0 };
  const identity = `${BLOCK_WORLD_GENERATOR_VERSION}:${input.countryId}:${input.cityId}:${input.seed}`;
  const layoutId = deterministicId(`${identity}:layout`);
  if (input.previous && input.previous.id !== layoutId) throw new Error("Previous layout identity mismatch");
  const blocks: CityBlockV1[] = []; const placements: TaskPlacementV1[] = []; const districtLayouts: DistrictLayoutV1[] = [];
  const districts = [...input.districts].sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));
  const previousPlacements = new Map(input.previous?.placements.map((p) => [p.taskId, p]) ?? []);
  const kinds = new Map(input.districts.flatMap(d => d.tasks.map(t => [t.id, t.visualKind ?? "BUILDING"] as const)));
  const durableTriggers = new Set(input.districts.flatMap(d => d.tasks.flatMap(t => t.serviceTrigger ? [t.serviceTrigger] : [])));
  const activePlacements = new Map([...previousPlacements].filter(([taskId]) => kinds.has(taskId)));
  const retainedDistrictIds = new Set(districts.map((d) => deterministicId(`${identity}:district:${d.id}`)));
  const retainedBlockIds = new Set(input.previous?.blocks.filter((b) => retainedDistrictIds.has(b.districtLayoutId)).map((b) => b.id) ?? []);
  const reservedBlocks = input.previous?.blocks.filter((b) => retainedBlockIds.has(b.id)).map((b) => ({ ...b })) ?? [];
  const siteMarkers = input.previous?.siteMarkers.filter((m) => retainedBlockIds.has(m.blockId)).map((m) => ({ ...m })) ?? [];
  // Recorded slots keep uniqueness even after deletion. A relocation marker
  // carries its original task owner, so transferring that task is permitted.
  const landmarkOwners = new Map<string, Set<string>>();
  const landmarkBlocks = new Set<string>();
  const reserveLandmark = (family: string, owner: string, blockId: string) => {
    if (!isCityLandmark(family)) return;
    const owners = landmarkOwners.get(family) ?? new Set<string>();
    owners.add(owner); landmarkOwners.set(family, owners); landmarkBlocks.add(blockId);
  };
  const recordedOwners = new Map([...previousPlacements.values()].map(p => [`${p.blockId}:${p.slotKey}`, p.taskId]));
  for (const marker of input.previous?.siteMarkers ?? []) {
    if (marker.kind === "RELOCATED" && marker.targetTaskId) recordedOwners.set(`${marker.blockId}:${marker.slotKey}`, marker.targetTaskId);
  }
  for (const block of input.previous?.blocks ?? []) {
    for (const [slot, family] of Object.entries(block.parameters.slotFamilies as Record<string, string> ?? {})) {
      const key = `${block.id}:${slot}`;
      reserveLandmark(family, recordedOwners.get(key) ?? `closed:${key}`, block.id);
    }
  }
  type DistrictContext = {
    district: BlockLayoutDistrictInput; districtLayoutId: string; districtOrigin: { x: number; y: number };
    districtBlocks: CityBlockV1[]; occupied: Set<string>;
    available: Array<{ block: CityBlockV1; slot: BlockSlot }>;
    slotCounts: Map<string, number>;
  };
  const contexts: DistrictContext[] = [];
  const pending: Array<{ task: BlockLayoutTaskInput; context: DistrictContext }> = [];
  // Load every stable placement before planning any new task. This also makes
  // city-wide infrastructure thresholds see the same state as live creation.
  for (const district of districts) {
    const districtLayoutId = deterministicId(`${identity}:district:${district.id}`);
    const previousDistrict = input.previous?.districtLayouts.find((d) => d.id === districtLayoutId);
    // Empty future districts are metadata only; they do not reserve terrain.
    const districtOrigin = previousDistrict
      ? { x: previousDistrict.bounds.minX, y: previousDistrict.bounds.minY }
      : origin;
    const districtBlocks = reservedBlocks.filter((b) => b.districtLayoutId === districtLayoutId);
    districtBlocks.sort((a, b) => a.sequence - b.sequence);
    const blockIds = new Set(districtBlocks.map((b) => b.id));
    const districtMarkers = siteMarkers.filter((m) => blockIds.has(m.blockId));
    const occupied = new Set(districtMarkers.map((m) => `${m.blockId}:${m.slotKey}`));
    const allSlots = districtBlocks.flatMap((block) => blockSlots(block).map((slot) => ({ block, slot })));
    const slotIndex = new Map(allSlots.map((s) => [`${s.block.id}:${s.slot.key}`, s.slot]));
    const tasks = [...district.tasks].sort((a, b) => a.taskNumber - b.taskNumber || a.id.localeCompare(b.id));
    // Reserve existing placements before allocating any newly imported task.
    for (const task of tasks) {
      const previous = previousPlacements.get(task.id); if (!previous) continue;
      const slot = slotIndex.get(`${previous.blockId}:${previous.slotKey}`);
      if (!slot || !task.autoVisualKind && slot.kind !== (task.visualKind ?? "BUILDING")) throw new Error(`Incompatible previous slot for ${task.id}`);
      if (!parkSizeFitsSlot(task.parkSize, slot)) throw new Error(`Incompatible previous park size for ${task.id}`);
      if (task.requestedFamily && slot.buildingFamily !== task.requestedFamily) throw new Error(`Incompatible previous family for ${task.id}`);
      const key = `${previous.blockId}:${previous.slotKey}`;
      if (occupied.has(key)) throw new Error(`Duplicate occupied slot for ${task.id}`); occupied.add(key);
      const updated = { ...previous, constructionStage: task.constructionStage,
        buildingFamily: slot.buildingFamily ?? task.buildingFamily, facadeVariant: task.facadeVariant,
        ...(slot.serviceRole ? { serviceRole: slot.serviceRole } : {}) };
      placements.push(updated); activePlacements.set(task.id, updated); kinds.set(task.id, slot.kind);
    }
    const context: DistrictContext = { district, districtLayoutId, districtOrigin, districtBlocks, occupied,
      available: allSlots.filter(({ block, slot }) => !occupied.has(`${block.id}:${slot.key}`)),
      slotCounts: new Map(districtBlocks.map(block => [block.id, allSlots.filter(value => value.block.id === block.id).length])),
    };
    contexts.push(context);
    for (const task of tasks) if (!previousPlacements.has(task.id)) pending.push({ task, context });
  }
  // The durable task number, not district grouping, defines construction order.
  // Replaying an interleaved city must not move its railway/airport to another
  // task simply because one district happened to be enumerated first.
  const homeUsage = new Map<string, Map<string, number>>();
  const recordHome = (placement: TaskPlacementV1) => {
    if (placement.serviceRole || kinds.get(placement.taskId) !== "BUILDING") return;
    let counts = homeUsage.get(placement.blockId);
    if (!counts) { counts = new Map(); homeUsage.set(placement.blockId, counts); }
    counts.set(placement.buildingFamily, (counts.get(placement.buildingFamily) ?? 0) + 1);
  };
  for (const placement of activePlacements.values()) recordHome(placement);
  pending.sort((a, b) => a.task.taskNumber - b.task.taskNumber || a.task.id.localeCompare(b.task.id));
  for (const { task, context } of pending) {
      const { district, districtLayoutId, districtBlocks, available, occupied } = context;
      const kind = task.visualKind ?? "BUILDING";
      const requestedFamily = task.requestedFamily ?? (task.serviceRoleAssigned && task.serviceRole ? task.buildingFamily : undefined);
      if (requestedFamily && isCityLandmark(requestedFamily)
        && [...landmarkOwners.get(requestedFamily) ?? []].some(owner => owner !== task.id)) {
        throw new UniqueBuildingConflictError("Такое уникальное здание уже есть в городе или на его сохранённом участке.");
      }
      if (task.requestedFamily && !task.serviceRoleAssigned) {
        const reserved = available.find(({ block, slot }) => slot.kind === "BUILDING" && !occupied.has(`${block.id}:${slot.key}`)
          && (block.parameters.slotRoles as Record<string, BlockServiceRole> | undefined)?.[slot.key]);
        if (reserved && !familyFitsSlot(task.requestedFamily,reserved.slot)) {
          throw new BlockReservationConflictError(`Следующий участок зарезервирован под инфраструктуру. Выберите семейство ${reserved.slot.buildingFamily} или уберите явное указание семейства.`);
        }
      }
      const eligible = ({ block, slot }: { block: CityBlockV1; slot: BlockSlot }) =>
        !occupied.has(`${block.id}:${slot.key}`) && (task.autoVisualKind || slot.kind === kind)
        && parkSizeFitsSlot(task.parkSize, slot)
        && (!requestedFamily || familyFitsSlot(requestedFamily,slot))
        && (!task.serviceRoleAssigned || !(block.parameters.slotRoles as Record<string, BlockServiceRole> | undefined)?.[slot.key]);
      const preferred = () => available.find(value => eligible(value)
        && (value.block.parameters.slotRoles as Record<string,BlockServiceRole> | undefined)?.[value.slot.key]) ?? available.find(eligible);
      const pocketSite = () => {
        if (task.parkSize !== "POCKET") return undefined;
        const vacant = available.find(({ block, slot }) => slot.kind === "BUILDING"
          && !occupied.has(`${block.id}:${slot.key}`)
          && !(block.parameters.slotRoles as Record<string, BlockServiceRole> | undefined)?.[slot.key]
          && !(block.parameters.slotFamilies as Record<string, string> | undefined)?.[slot.key]
          && parkSizeFitsSlot("POCKET", { ...slot, kind: "PARK" }));
        if (!vacant) return undefined;
        // Persist only the parcel's permitted use, never its dimensions,
        // entrance, access or occupied neighbours. Closed sites are excluded.
        vacant.block.parameters = { ...vacant.block.parameters,
          slotKinds: { ...vacant.block.parameters.slotKinds as Record<string, "PARK">, [vacant.slot.key]: "PARK" } };
        vacant.slot = blockSlots(vacant.block).find(slot => slot.key === vacant.slot.key)!;
        return vacant;
      };
      let selected = preferred() ?? pocketSite();
      if (!selected) {
        const sequence = districtBlocks.reduce((high, block) => Math.max(high, block.sequence), -1) + 1;
        const site = nextBlockSite(districtBlocks, districtLayoutId,
          origin, task.autoVisualKind || task.parkSize === "POCKET" ? "BUILDING" : kind, sequence, input.canPlaceBlock, reservedBlocks, task.parkSize, requestedFamily);
        const template = site.template;
        const block: CityBlockV1 = { id: deterministicId(`${identity}:district:${district.id}:block:${sequence}`), districtLayoutId, sequence,
          kind: template.kind === "BUILDING" ? "RESIDENTIAL" : template.kind === "PARKING" ? "TRANSPORT" : template.kind,
          templateKey: template.key, templateVersion: BLOCK_TEMPLATE_VERSION, variant: "south", seed: input.seed + sequence,
          origin: site.origin,
          width: template.widthModules * MODULE, height: template.heightModules * MODULE,
          parameters: { packingCorner: ["NW", "NE", "SW", "SE"][((input.seed + sequence + district.sequence) % 4 + 4) % 4], infill: true,
            ...(site.separator ? { districtSeparator: site.separator } : {}),
            ...(requestedFamily ? { firstFamily: compactBuildingShapeFamily(requestedFamily)! } : {}) }, summary: {} };
        block.parameters.sitePlan = createBlockSitePlan(block);
        districtBlocks.push(block); reservedBlocks.push(block);
        const slots = blockSlots(block);
        context.slotCounts.set(block.id, slots.length);
        for (const slot of slots) available.push({ block, slot });
        selected = (preferred() ?? pocketSite())!;
      }
      if (task.serviceRole) selected.block.parameters = { ...selected.block.parameters,
        slotRoles: { ...selected.block.parameters.slotRoles as Record<string,BlockServiceRole>, [selected.slot.key]: task.serviceRole },
        slotRoleTriggers: { ...selected.block.parameters.slotRoleTriggers as Record<string,string>,
          [selected.slot.key]: task.serviceTrigger ?? `task:${task.id}:${task.serviceRole}` } };
      else if (!task.serviceRoleAssigned) {
        reserveNextInfrastructure(district, districtBlocks, reservedBlocks, available, occupied, activePlacements.values(), kinds, durableTriggers,requestedFamily);
        selected = preferred()!;
      }
      const serviceRole = (selected.block.parameters.slotRoles as Record<string, BlockServiceRole> | undefined)?.[selected.slot.key];
      if (serviceRole && requestedFamily && isCityLandmark(requestedFamily)) {
        throw new BlockReservationConflictError("Уникальное здание не может занять участок обязательной инфраструктуры.");
      }
      const requestedServiceRole = requestedFamily && compactBuildingServiceRole(requestedFamily);
      if (serviceRole && requestedServiceRole && requestedServiceRole !== serviceRole) {
        throw new BlockReservationConflictError(`Роль выбранного семейства ${requestedServiceRole} не совпадает с ролью участка ${serviceRole}. Уберите явное указание семейства или выберите подходящее.`);
      }
      occupied.add(`${selected.block.id}:${selected.slot.key}`);
      const width = selected.slot.footprintBounds.maxX - selected.slot.footprintBounds.minX + 1;
      const height = selected.slot.footprintBounds.maxY - selected.slot.footprintBounds.minY + 1;
      const landmarkEntropy = Number.parseInt(checksum(`${identity}:${selected.block.id}:landmark`).slice(0, 8), 16);
      const landmarkCandidates = !requestedFamily && !serviceRole && selected.slot.kind === "BUILDING"
        && !landmarkBlocks.has(selected.block.id) && landmarkEntropy % 3 !== 0
        ? cityLandmarkCandidates(width, height).filter(family => !landmarkOwners.has(family)) : [];
      const authoredFamily = requestedFamily ?? (!task.serviceRoleAssigned && serviceRole ? serviceFamilyForSlot(serviceRole,selected.slot) : undefined)
        ?? (landmarkCandidates.length ? landmarkCandidates[landmarkEntropy % landmarkCandidates.length] : undefined)
        ?? (!serviceRole && selected.slot.kind === "BUILDING" ? compactHomeFamily(
          selected.slot.footprintBounds.maxX - selected.slot.footprintBounds.minX + 1,
          selected.slot.footprintBounds.maxY - selected.slot.footprintBounds.minY + 1,
          Number.parseInt(checksum(`${input.seed}:${district.id}:${task.taskNumber}`).slice(0, 8), 16), homeUsage.get(selected.block.id)) : undefined)
        ?? selected.slot.buildingFamily ?? task.buildingFamily;
      if (selected.slot.kind === "BUILDING") {
        selected.block.parameters = {...selected.block.parameters,
          slotFamilies:{...selected.block.parameters.slotFamilies as Record<string,string>,[selected.slot.key]:authoredFamily}};
        selected.slot.buildingFamily = authoredFamily;
      }
      const placement = { taskId: task.id, blockId: selected.block.id, slotKey: selected.slot.key,
        buildingFamily: authoredFamily, facadeVariant: task.facadeVariant,
        constructionStage: task.constructionStage, ...(serviceRole ? { serviceRole } : {}) };
      placements.push(placement); activePlacements.set(task.id, placement); kinds.set(task.id, selected.slot.kind);
      recordHome(placement);
      reserveLandmark(authoredFamily, task.id, selected.block.id);
      reserveNextInfrastructure(district, districtBlocks, reservedBlocks, available, occupied, activePlacements.values(), kinds, durableTriggers);
  }
  const counts = new Map<string, number>(); const markerCounts = new Map<string, number>();
  const taskNumbers = new Map(input.districts.flatMap(d => d.tasks.map(t => [t.id, t.taskNumber] as const)));
  const numbersByBlock = new Map<string, number[]>();
  for (const p of placements) {
    const numbers = numbersByBlock.get(p.blockId) ?? [];
    numbers.push(taskNumbers.get(p.taskId)!); numbersByBlock.set(p.blockId, numbers);
  }
  for (const placement of placements) counts.set(placement.blockId, (counts.get(placement.blockId) ?? 0) + 1);
  for (const marker of siteMarkers) markerCounts.set(marker.blockId, (markerCounts.get(marker.blockId) ?? 0) + 1);
  for (const { district, districtLayoutId, districtOrigin, districtBlocks, slotCounts } of contexts) {
    for (const block of districtBlocks) {
      const slotCount = slotCounts.get(block.id)!; const taskCount = counts.get(block.id) ?? 0;
      block.summary = { slotCount, taskCount, taskNumbers: (numbersByBlock.get(block.id) ?? []).sort((a, b) => a - b), occupiedSlots: taskCount,
        plannedSlots: slotCount - taskCount - (markerCounts.get(block.id) ?? 0) };
    }
    blocks.push(...districtBlocks);
    districtLayouts.push({ id: districtLayoutId, districtId: district.id, sequence: district.sequence, archetype: district.archetype,
      bounds: { minX: districtBlocks.reduce((left, b) => Math.min(left, b.origin.x), districtBlocks.length ? Infinity : districtOrigin.x),
        minY: districtBlocks.reduce((top, b) => Math.min(top, b.origin.y), districtBlocks.length ? Infinity : districtOrigin.y),
        maxX: districtBlocks.reduce((right, b) => Math.max(right, b.origin.x + b.width), districtBlocks.length ? -Infinity : districtOrigin.x + MODULE),
        maxY: districtBlocks.reduce((bottom, b) => Math.max(bottom, b.origin.y + b.height), districtBlocks.length ? -Infinity : districtOrigin.y + MODULE) } });
  }
  const network = compileRoadNetwork(blocks, origin);
  if (input.canPlaceBlock && blocks.length === 0) {
    if (!input.canPlaceBlock({ minX: origin.x - 2, minY: origin.y - 2, maxX: origin.x + MODULE + 2, maxY: origin.y + 2 })) {
      throw new BlockPlacementError("No buildable initial street; a terrain crossing needs an explicit bridge plan");
    }
  }
  const bounds = network.nodes.reduce((b, n) => ({ minX: Math.min(b.minX, n.x - 3), minY: Math.min(b.minY, n.y - 3),
    maxX: Math.max(b.maxX, n.x + 3), maxY: Math.max(b.maxY, n.y + 3) }),
  { minX: origin.x - 3, minY: origin.y - 3, maxX: origin.x + 3, maxY: origin.y + MODULE });
  const layout = { id: layoutId, countryId: input.countryId, cityId: input.cityId, generatorVersion: BLOCK_WORLD_GENERATOR_VERSION,
    seed: input.seed, revision: input.revision, status: "READY" as const, bounds, districtLayouts, blocks,
    placements: placements.sort((a, b) => a.taskId.localeCompare(b.taskId)), siteMarkers,
    roadNetwork: { ...network, id: deterministicId(`${identity}:roads`), checksum: checksum(network) } };
  return { ...layout, checksum: checksum(layout) };
}
