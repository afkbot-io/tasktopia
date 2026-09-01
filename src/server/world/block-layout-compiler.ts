import { createHash } from "node:crypto";
import {
  BLOCK_WORLD_GENERATOR_VERSION,
  type CompiledBlockLayoutV1,
  type ConstructionStage,
} from "../../shared/block-world";
import { auditSemanticRoadNetwork, SEMANTIC_ROAD_SCHEMA_VERSION, type SemanticRoadNetwork } from "../../shared/semantic-road";

export type BlockLayoutTaskInput = {
  id: string;
  buildingFamily: string;
  facadeVariant: string;
  constructionStage: ConstructionStage;
};

export type BlockLayoutCompilerInput = {
  countryId: string;
  cityId: string;
  district: { id: string; archetype: string };
  seed: number;
  revision: number;
  tasks: BlockLayoutTaskInput[];
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function deterministicId(namespace: string): string {
  const source = createHash("sha256").update(namespace).digest("hex").slice(0, 32).split("");
  source[12] = "5";
  source[16] = "8";
  const value = source.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function assertCompilerInput(input: BlockLayoutCompilerInput): void {
  if (!input.countryId || !input.cityId || !input.district.id) throw new Error("Block-v1 compiler requires country, city, and district IDs");
  if (!Number.isSafeInteger(input.seed)) throw new Error("Block-v1 seed must be a safe integer");
  if (!Number.isSafeInteger(input.revision) || input.revision <= 0) throw new Error("Block-v1 revision must be a positive integer");
  if (input.tasks.length > 8) throw new Error("The starter block-v1 template has eight task slots");
  const taskIds = new Set<string>();
  for (const task of input.tasks) {
    if (!task.id || taskIds.has(task.id)) throw new Error(`Duplicate block-v1 task: ${task.id}`);
    taskIds.add(task.id);
    if (!Number.isInteger(task.constructionStage) || task.constructionStage < 1 || task.constructionStage > 5) {
      throw new Error(`Invalid block-v1 construction stage for task ${task.id}`);
    }
  }
}

export function compileBlockLayout(input: BlockLayoutCompilerInput): CompiledBlockLayoutV1 {
  assertCompilerInput(input);
  const identity = `${BLOCK_WORLD_GENERATOR_VERSION}:${input.countryId}:${input.cityId}:${input.revision}:${input.seed}`;
  const layoutId = deterministicId(`${identity}:layout`);
  const districtLayoutId = deterministicId(`${identity}:district:${input.district.id}`);
  const blockId = deterministicId(`${identity}:block:0`);
  const networkId = deterministicId(`${identity}:roads`);
  const bounds = { minX: 0, minY: 0, maxX: 31, maxY: 31 };
  const tasks = [...input.tasks].sort((left, right) => left.id.localeCompare(right.id));
  const semanticRoadNetwork: SemanticRoadNetwork = {
    schemaVersion: SEMANTIC_ROAD_SCHEMA_VERSION,
    nodes: [
      { id: "west", x: 0, y: 16, kind: "BOUNDARY" },
      { id: "junction", x: 16, y: 16, kind: "JUNCTION" },
      { id: "east", x: 31, y: 16, kind: "BOUNDARY" },
      { id: "south", x: 16, y: 31, kind: "BOUNDARY" },
    ],
    segments: [
      { id: "west-junction", fromNodeId: "west", toNodeId: "junction", roadClass: "COLLECTOR", widthCells: 7,
        geometry: { start: { x: 0, y: 16 }, runs: [{ direction: "E", length: 16 }] } },
      { id: "junction-east", fromNodeId: "junction", toNodeId: "east", roadClass: "COLLECTOR", widthCells: 7,
        geometry: { start: { x: 16, y: 16 }, runs: [{ direction: "E", length: 15 }] } },
      { id: "junction-south", fromNodeId: "junction", toNodeId: "south", roadClass: "LOCAL", widthCells: 3,
        geometry: { start: { x: 16, y: 16 }, runs: [{ direction: "S", length: 15 }] } },
    ],
  };
  auditSemanticRoadNetwork(semanticRoadNetwork);
  const roadNetwork = {
    id: networkId,
    ...semanticRoadNetwork,
    checksum: createHash("sha256").update(canonicalJson(semanticRoadNetwork)).digest("hex"),
  };

  const semanticLayout = {
    id: layoutId,
    countryId: input.countryId,
    cityId: input.cityId,
    generatorVersion: BLOCK_WORLD_GENERATOR_VERSION,
    seed: input.seed,
    revision: input.revision,
    status: "READY" as const,
    bounds,
    districtLayouts: [{
      id: districtLayoutId,
      districtId: input.district.id,
      sequence: 0,
      archetype: input.district.archetype,
      bounds,
    }],
    blocks: [{
      id: blockId,
      districtLayoutId,
      sequence: 0,
      kind: "RESIDENTIAL" as const,
      templateKey: "mixed-urban-grid",
      templateVersion: 1,
      variant: "north",
      seed: input.seed,
      origin: { x: 0, y: 0 },
      width: 32,
      height: 32,
      parameters: { renderCellPx: 4, sidewalkWidthCells: 1, localRoadWidthCells: 3, slotCount: 8 },
      summary: { occupiedSlots: tasks.length, taskCount: tasks.length },
    }],
    placements: tasks.map((task, index) => ({
      taskId: task.id,
      blockId,
      slotKey: `lot-${index}`,
      buildingFamily: task.buildingFamily,
      facadeVariant: task.facadeVariant,
      constructionStage: task.constructionStage,
    })),
    siteMarkers: [],
    roadNetwork,
  };
  const checksum = createHash("sha256").update(canonicalJson(semanticLayout)).digest("hex");
  return { ...semanticLayout, checksum };
}
