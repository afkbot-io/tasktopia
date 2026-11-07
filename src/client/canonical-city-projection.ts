import type { ChunkDto, ChunkPayloadDto, ChunkTaskDto } from "../shared/contracts";
import { yieldPreparationTask } from "../shared/cooperative-preparation";

type PhysicalRecord = {hash:string;stages:string;chunk:ChunkDto};
type PageResult = {ok:true;id:string;record:PhysicalRecord} | {ok:false;error:unknown};

export type CanonicalPhysicalSnapshot = {chunks: readonly ChunkDto[];completed: readonly ChunkTaskDto[]};

/** The physical snapshot has a different lifetime from viewport raster data. */
export class CanonicalCityProjection {
  current: CanonicalPhysicalSnapshot = {chunks: [],completed: []};
  pending = false;
  private records = new Map<string,PhysicalRecord>();
  private run: {key:string;controller:AbortController;promise:Promise<boolean>} | undefined;
  private disposed = false;
  constructor(private readonly readWidth = 1) {
    if (!Number.isInteger(readWidth) || readWidth < 1 || readWidth > 2) throw new RangeError("Invalid physical read width");
  }
  prepare(key: string,payloads: readonly ChunkPayloadDto[],completed: readonly ChunkTaskDto[],
    read: (payload: ChunkPayloadDto,signal: AbortSignal) => Promise<ChunkDto>): Promise<boolean> {
    if(this.disposed)return Promise.resolve(false);
    if(this.run?.key===key)return this.run.promise;
    this.cancel();
    const run={key,controller:new AbortController(),promise:Promise.resolve(false)};
    this.run=run;this.pending=true;
    run.promise=(async()=>{
      const records=new Map<string,PhysicalRecord>(),chunks:ChunkDto[]=[];
      const pending=new Map<number,Promise<PageResult>>();
      // Attach rejection handlers as soon as a prefetch starts. A later page
      // can fail before its ordered adoption, or after this owner is cancelled.
      const enqueue=(index:number)=>{
        if(index>=payloads.length)return;
        const payload=payloads[index]!;
        pending.set(index,(async()=>{
          run.controller.signal.throwIfAborted();
          const id=`${payload.chunkX},${payload.chunkY}`;
          const stages=JSON.stringify([payload.tasks.map(task=>[task.id,task.stage]),payload.decorationContext.tasks.map(task=>[task.id,task.stage])]);
          const previous=this.records.get(id);
          let chunk:ChunkDto;
          if(previous?.hash===payload.contentHash&&previous.stages===stages){
            chunk=previous.chunk.tasks===payload.tasks&&previous.chunk.worldVersion===payload.publishedVersion
              ? previous.chunk : {...previous.chunk,tasks:payload.tasks,worldVersion:payload.publishedVersion};
          }else{
            const materialized=await read(payload,run.controller.signal);
            // The one retained scene already owns immutable task metadata.
            chunk={...materialized,tasks:payload.tasks,worldFeatures:payload.worldFeatures,
              plannedSites:payload.plannedSites,blockPlaques:payload.blockPlaques};
          }
          return {id,record:{hash:payload.contentHash,stages,chunk}};
        })().then(value=>({ok:true as const,...value}),error=>({ok:false as const,error})));
      };
      let slice=performance.now();
      try{
        for(let index=0;index<this.readWidth;index++)enqueue(index);
        for(let index=0;index<payloads.length;index++){
          const result=await pending.get(index)!;pending.delete(index);
          run.controller.signal.throwIfAborted();
          if(this.disposed||this.run!==run)return false;
          if(!result.ok)throw result.error;
          chunks.push(result.record.chunk);records.set(result.id,result.record);
          enqueue(index+this.readWidth);
          if(performance.now()-slice>=4){await yieldPreparationTask(run.controller.signal);slice=performance.now();}
        }
        if(this.disposed||this.run!==run)return false;
        this.records=records;this.current={chunks,completed};this.pending=false;
        return true;
      }catch(error){
        if(run.controller.signal.aborted)return false;
        // Failure belongs to this run. Stop sibling reads without disturbing
        // another owner's replacement or clearing the previous ready city.
        run.controller.abort(error);
        throw error;
      }finally{if(this.run===run)this.run=undefined;}
    })();
    return run.promise;
  }
  cancel(): void {const run=this.run;this.run=undefined;run?.controller.abort(new DOMException("Canonical owner cancelled","AbortError"));}
  dispose(): void {this.disposed=true;this.cancel();this.records.clear();this.current={chunks:[],completed:[]};}
}
