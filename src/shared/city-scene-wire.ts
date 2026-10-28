import type { CitySceneDto } from "./city-scene-contract";
import type { Cell, ChunkPayloadDto, ChunkTaskDto } from "./contracts";
import { CITY_SCENE_MAX_CHUNKS } from "./city-capacity";

export const CITY_SCENE_COMPACT_ACCEPT = "application/vnd.tasktopia.city-scene+json; encoding=compact-v1";
export function acceptsCompactCityScene(header: string | undefined): boolean {
  return Boolean(header?.split(",").some(value => {
    const [media, ...parameters] = value.toLowerCase().split(";").map(part => part.trim());
    if (media !== "application/vnd.tasktopia.city-scene+json" || !parameters.includes("encoding=compact-v1")) return false;
    const quality = parameters.find(parameter => parameter.startsWith("q="));
    return quality === undefined || /^q=(?:1(?:\.0{1,3})?|0(?:\.\d{1,3})?)$/.test(quality) && Number(quality.slice(2)) > 0;
  }));
}
type PackedCells = { r: [number, number, number, number] } | { p: number[] };
type PackedTask = Omit<ChunkTaskDto, "footprint" | "accessPath"> & { footprint: PackedCells; accessPath: PackedCells };
type Context = ChunkPayloadDto["decorationContext"];
type WireChunk = Omit<ChunkPayloadDto, "tasks" | "decorationContext"> & {
  tasks: number[]; decorationContext: Omit<Context, "tasks"> & { tasks: number[] };
};
export type CitySceneWire = Omit<CitySceneDto, "chunks" | "completedDistrictSnapshots"> & {
  kind: "city.scene.compact"; version: 1; taskTable: PackedTask[]; chunks: WireChunk[];
  completedDistrictSnapshots: Array<Omit<CitySceneDto["completedDistrictSnapshots"][number], "tasks"> & { tasks: number[] }>;
};

function packCells(cells: readonly Cell[]): PackedCells {
  if (cells.length) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const { x, y } of cells) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    const width = maxX - minX + 1, height = maxY - minY + 1;
    if (width * height === cells.length && cells.every((cell, n) => cell.x === minX + n % width && cell.y === minY + Math.floor(n / width))) {
      return { r: [minX, minY, width, height] };
    }
  }
  return { p: cells.flatMap(cell => [cell.x, cell.y]) };
}

/** Opt-in wire projection. The legacy response and canonical scene hashes
 * remain unchanged. One task and one footprint are shared by all page halos. */
export function encodeCitySceneWire(scene: CitySceneDto): CitySceneWire {
  const tasks: ChunkTaskDto[] = [], indexes = new Map<string, number>();
  const retain = (task: ChunkTaskDto) => {
    if (indexes.has(task.id)) return;
    indexes.set(task.id, tasks.length); tasks.push(task);
  };
  for (const chunk of scene.chunks) for (const task of chunk.tasks) retain(task);
  for (const snapshot of scene.completedDistrictSnapshots) for (const task of snapshot.tasks) retain(task);
  const reference = (task: Pick<ChunkTaskDto, "id">) => {
    const index = indexes.get(task.id);
    if (index === undefined) throw new Error("City halo task is missing from the complete scene");
    return index;
  };
  return {
    ...scene, kind: "city.scene.compact", version: 1,
    taskTable: tasks.map(task => ({ ...task, footprint: packCells(task.footprint), accessPath: packCells(task.accessPath) })),
    chunks: scene.chunks.map(chunk => ({ ...chunk, tasks: chunk.tasks.map(reference),
      decorationContext: { ...chunk.decorationContext, tasks: chunk.decorationContext.tasks.map(reference) } })),
    completedDistrictSnapshots: scene.completedDistrictSnapshots.map(snapshot => ({ ...snapshot, tasks: snapshot.tasks.map(reference) })),
  };
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function invalid(): never { throw new Error("Некорректные данные городской сцены"); }
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) return invalid();
  return value;
}
function integer(value: unknown): value is number { return Number.isSafeInteger(value); }

/** Decode in the scene worker. Expansion has explicit per-record and aggregate
 * bounds; malformed indexes must never turn into missing or invented tasks. */
export function decodeCitySceneWire(input: unknown): CitySceneDto {
  if (!record(input)) return invalid();
  if (input.kind !== "city.scene.compact") {
    // An older rollback server still serves the established schema4/5 DTO.
    if ((input.schemaVersion === 4 || input.schemaVersion === 5) && Array.isArray(input.chunks)) return input as CitySceneDto;
    return invalid();
  }
  if (input.version !== 1 || input.schemaVersion !== 5 && input.schemaVersion !== 4) return invalid();
  let expandedCells = 0;
  const unpack = (value: unknown): Cell[] => {
    if (!record(value)) return invalid();
    let cells: Cell[];
    if (Array.isArray(value.r)) {
      if (value.r.length !== 4 || !value.r.every(integer)) return invalid();
      const [x, y, width, height] = value.r as [number, number, number, number];
      const count = width * height;
      if (width < 1 || height < 1 || !integer(count) || count > 65_536 || !integer(x + width - 1) || !integer(y + height - 1)) return invalid();
      expandedCells += count;
      if (expandedCells > 4_194_304) return invalid();
      cells = Array.from({ length: count }, (_, n) => ({ x: x + n % width, y: y + Math.floor(n / width) }));
    } else {
      const points = list(value.p, 131_072);
      if (points.length % 2 || !points.every(integer)) return invalid();
      expandedCells += points.length / 2;
      if (expandedCells > 4_194_304) return invalid();
      cells = Array.from({ length: points.length / 2 }, (_, n) => ({ x: points[n * 2] as number, y: points[n * 2 + 1] as number }));
    }
    return cells;
  };
  const ids = new Set<string>();
  const tasks = list(input.taskTable, 100_000).map(value => {
    if (!record(value) || typeof value.id !== "string" || !value.id || ids.has(value.id)) return invalid();
    ids.add(value.id);
    return { ...value, footprint: unpack(value.footprint), accessPath: unpack(value.accessPath) } as ChunkTaskDto;
  });
  const contextTasks: Context["tasks"] = tasks.map(({ id, taskNumber, visualKind, stage, footprint, accessPath }) =>
    ({ id, taskNumber, visualKind, stage, footprint, accessPath }));
  let expandedReferences = 0;
  const references = <T>(values: unknown, table: readonly T[]): T[] => {
    const indexes = list(values, 100_000);
    expandedReferences += indexes.length;
    if (expandedReferences > 4_194_304) return invalid();
    return indexes.map(index => {
    if (!integer(index) || index < 0 || index >= table.length) return invalid();
    return table[index]!;
    });
  };
  const chunks = list(input.chunks, CITY_SCENE_MAX_CHUNKS).map(value => {
    if (!record(value) || !record(value.decorationContext)) return invalid();
    return { ...value, tasks: references(value.tasks, tasks),
      decorationContext: { ...value.decorationContext, tasks: references(value.decorationContext.tasks, contextTasks) } } as ChunkPayloadDto;
  });
  const completedDistrictSnapshots = list(input.completedDistrictSnapshots, 100_000).map(value => {
    if (!record(value)) return invalid();
    return { ...value, tasks: references(value.tasks, tasks) } as CitySceneDto["completedDistrictSnapshots"][number];
  });
  const { kind: _kind, version: _version, taskTable: _table, ...scene } = input;
  void _kind; void _version; void _table;
  return { ...scene, chunks, completedDistrictSnapshots } as CitySceneDto;
}
