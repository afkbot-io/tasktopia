import type { CitySceneDto } from "../shared/city-scene-contract";
import type { CellRunDto } from "../shared/contracts";
import { completePreparation, prepareCooperatively, type CooperativePreparationOptions } from "./cooperative-preparation";

type Fields = Record<string, unknown>;
type RunMetadata = { fields: Fields; start: Fields; end: Fields;
  order: string[]; startOrder: string[]; endOrder: string[]; canonicalOrder: boolean };
type RunReference = { runArray: number };
export type CitySceneTransfer = {
  kind: "tasktopia.city-scene.transfer"; version: 1; scene: unknown;
  coordinates: Float64Array; metadataIndices: Uint32Array;
  arrays: Array<{ offset: number; length: number }>; metadata: RunMetadata[];
};
const KIND = "tasktopia.city-scene.transfer";
const omit = (value: object, keys: readonly string[]): Fields => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
// Typed signatures distinguish absent fields, undefined, signed zero and extra
// metadata. Coordinate values never enter this small dictionary.
function signature(value: unknown): string {
  if (value === undefined) return "u";
  if (value === null) return "n";
  if (typeof value === "number") return `d${Object.is(value, -0) ? "-0" : String(value)}`;
  if (typeof value !== "object") return `${typeof value}:${JSON.stringify(value)}`;
  if (Array.isArray(value)) return `a[${value.map(signature).join(",")}]`;
  return `o[${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}:${signature(item)}`).join(",")}]`;
}

/** Only run-bearing containers are copied. Task tables, geometry and their
 * aliases remain in the same structured-clone graph, without another walk. */
function* mapRunContainers(scene: CitySceneDto, map: (value: unknown) => unknown): Generator<void, CitySceneDto, void> {
  const memo = new WeakMap<object, object>();
  function district(value: Fields): Fields {
    const cached = memo.get(value); if (cached) return cached as Fields;
    const next = { ...value }; memo.set(value, next);
    if (Object.hasOwn(value, "cellRuns")) next.cellRuns = map(value.cellRuns);
    return next;
  }
  const chunks: CitySceneDto["chunks"] = [];
  for (const chunk of scene.chunks) {
    const cached = memo.get(chunk);
    if (cached) { chunks.push(cached as typeof chunk); yield; continue; }
    const next = { ...chunk }; memo.set(chunk, next);
    next.roadRuns = map(chunk.roadRuns) as typeof chunk.roadRuns;
    next.surfaceRuns = map(chunk.surfaceRuns) as typeof chunk.surfaceRuns;
    if (chunk.districts) {
      const districts = [];
      for (const value of chunk.districts) { districts.push(district(value)); yield; }
      next.districts = districts as typeof chunk.districts;
    }
    if (chunk.decorationContext) {
      let context = memo.get(chunk.decorationContext) as typeof chunk.decorationContext | undefined;
      if (!context) {
        context = { ...chunk.decorationContext }; memo.set(chunk.decorationContext, context);
        context.surfaceHaloRuns = map(context.surfaceHaloRuns) as typeof context.surfaceHaloRuns;
        context.blockedCellRuns = map(context.blockedCellRuns) as typeof context.blockedCellRuns;
        if (context.districts) {
          const districts = [];
          for (const value of context.districts) { districts.push(district(value)); yield; }
          context.districts = districts as typeof context.districts;
        }
      }
      next.decorationContext = context;
    }
    chunks.push(next); yield;
  }
  return { ...scene, chunks };
}

/** Worker-private carrier. The public network/normalized DTO stays unchanged. */
export function packCitySceneTransfer(scene: CitySceneDto): CitySceneTransfer {
  const arrays: CitySceneTransfer["arrays"] = [], sources: CellRunDto[][] = [];
  const memo = new WeakMap<object, RunReference>(); let count = 0;
  const skeleton = completePreparation(mapRunContainers(scene, value => {
    if (!Array.isArray(value)) return value;
    const existing = memo.get(value); if (existing) return existing;
    const ref = { runArray: arrays.length }; memo.set(value, ref);
    arrays.push({ offset: count, length: value.length }); sources.push(value); count += value.length;
    if (!Number.isSafeInteger(count) || count > 0xffff_ffff) throw new Error("Invalid city run count");
    return ref;
  }));
  const coordinates = new Float64Array(count * 4), metadataIndices = new Uint32Array(count);
  const metadata: RunMetadata[] = [], metadataIds = new Map<string, number>(); let index = 0;
  const fieldKey = (value: object, order: string[], skipped: readonly string[]) => order.map(key =>
    `${JSON.stringify(key)}:${skipped.includes(key) ? "@coordinate" : signature((value as Fields)[key])}`).join(",");
  for (const runs of sources) for (const run of runs) {
    const x1=run.start.x,y1=run.start.y,x2=run.end.x,y2=run.end.y;
    if (!Number.isFinite(x1)||!Number.isFinite(y1)||!Number.isFinite(x2)||!Number.isFinite(y2)) throw new Error("Invalid city run coordinates");
    const offset=index*4;coordinates[offset]=x1;coordinates[offset+1]=y1;coordinates[offset+2]=x2;coordinates[offset+3]=y2;
    const order=Object.keys(run),startOrder=Object.keys(run.start),endOrder=Object.keys(run.end);
    const key=`r[${fieldKey(run,order,["start","end"])}]s[${fieldKey(run.start,startOrder,["x","y"])}]e[${fieldKey(run.end,endOrder,["x","y"])}]`;
    let id=metadataIds.get(key);
    if (id === undefined) {
      id=metadata.length;
      metadata.push({fields:omit(run,["start","end"]),start:omit(run.start,["x","y"]),end:omit(run.end,["x","y"]),
        order,startOrder,endOrder,canonicalOrder:order[0]==="start"&&order[1]==="end"
          &&startOrder[0]==="x"&&startOrder[1]==="y"&&endOrder[0]==="x"&&endOrder[1]==="y"});
      metadataIds.set(key,id);
    }
    metadataIndices[index++]=id;
  }
  return { kind: KIND, version: 1, scene: skeleton, coordinates, metadataIndices, arrays, metadata };
}

function* hydrate(value: CitySceneTransfer): Generator<void, CitySceneDto, void> {
  if (value.version !== 1 || !(value.coordinates instanceof Float64Array) || !(value.metadataIndices instanceof Uint32Array)
    || value.coordinates.length !== value.metadataIndices.length * 4) throw new Error("Invalid city run transfer");
  const arrays: CellRunDto[][] = []; let expected = 0;
  for (const descriptor of value.arrays) {
    if (!Number.isSafeInteger(descriptor.offset) || !Number.isSafeInteger(descriptor.length) || descriptor.length < 0
      || descriptor.offset !== expected || descriptor.offset + descriptor.length > value.metadataIndices.length) throw new Error("Invalid city run range");
    const runs: CellRunDto[] = [];
    for (let local = 0; local < descriptor.length; local++) {
      const index = descriptor.offset + local, meta = value.metadata[value.metadataIndices[index]!];
      if (!meta) throw new Error("Invalid city run metadata");
      const offset = index * 4;
      const x1=value.coordinates[offset]!,y1=value.coordinates[offset+1]!,x2=value.coordinates[offset+2]!,y2=value.coordinates[offset+3]!;
      if(meta.canonicalOrder)runs.push({start:{x:x1,y:y1,...meta.start},end:{x:x2,y:y2,...meta.end},...meta.fields});
      else {
        const point=(order:string[],fields:Fields,x:number,y:number)=>Object.fromEntries(order.map(key=>[key,key==="x"?x:key==="y"?y:fields[key]]));
        const start=point(meta.startOrder,meta.start,x1,y1),end=point(meta.endOrder,meta.end,x2,y2);
        runs.push(Object.fromEntries(meta.order.map(key=>[key,key==="start"?start:key==="end"?end:meta.fields[key]])) as CellRunDto);
      }
      if ((local & 63) === 63) yield;
    }
    arrays.push(runs); expected += descriptor.length; yield;
  }
  if (expected !== value.metadataIndices.length) throw new Error("Invalid city run coverage");
  return yield* mapRunContainers(value.scene as CitySceneDto, ref => {
    if (!ref || typeof ref !== "object" || !("runArray" in ref)) return ref;
    const index = (ref as RunReference).runArray;
    if (!Number.isInteger(index) || index < 0 || index >= arrays.length) throw new Error("Invalid city run reference");
    return arrays[index];
  });
}
export function hydrateCitySceneTransfer(value: CitySceneTransfer | CitySceneDto,
  options: CooperativePreparationOptions = {}): Promise<CitySceneDto> {
  return "kind" in value && value.kind === KIND
    ? prepareCooperatively(hydrate(value), options) : Promise.resolve(value as CitySceneDto);
}
