import type { ChunkDto, ChunkPayloadDto, ChunkTaskDto } from "../shared/contracts";
import { yieldPreparationTask } from "./cooperative-preparation";

export type CanonicalPhysicalSnapshot = {chunks: readonly ChunkDto[];completed: readonly ChunkTaskDto[]};

/** The physical snapshot has a different lifetime from viewport raster data. */
export class CanonicalCityProjection {
  current: CanonicalPhysicalSnapshot = {chunks: [],completed: []};
  pending = false;
  private records = new Map<string,{hash:string;stages:string;chunk:ChunkDto}>();
  private run: {key:string;controller:AbortController;promise:Promise<boolean>} | undefined;
  private disposed = false;
  prepare(key: string,payloads: readonly ChunkPayloadDto[],completed: readonly ChunkTaskDto[],
    read: (payload: ChunkPayloadDto,signal: AbortSignal) => Promise<ChunkDto>): Promise<boolean> {
    if(this.disposed)return Promise.resolve(false);
    if(this.run?.key===key)return this.run.promise;
    this.cancel();
    const run={key,controller:new AbortController(),promise:Promise.resolve(false)};
    this.run=run;this.pending=true;
    run.promise=(async()=>{
      const records=new Map<string,{hash:string;stages:string;chunk:ChunkDto}>(),chunks:ChunkDto[]=[];
      let slice=performance.now();
      try{
        for(const payload of payloads){
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
            // Worker transport clones metadata as well. The authoritative
            // immutable arrays already belong to the one retained full scene.
            chunk={...materialized,tasks:payload.tasks,worldFeatures:payload.worldFeatures,
              plannedSites:payload.plannedSites,blockPlaques:payload.blockPlaques};
          }
          run.controller.signal.throwIfAborted();
          if(this.disposed||this.run!==run)return false;
          chunks.push(chunk);records.set(id,{hash:payload.contentHash,stages,chunk});
          if(performance.now()-slice>=4){await yieldPreparationTask(run.controller.signal);slice=performance.now();}
        }
        if(this.disposed||this.run!==run)return false;
        this.records=records;this.current={chunks,completed};this.pending=false;
        return true;
      }catch(error){
        if(run.controller.signal.aborted)return false;
        throw error;
      }finally{if(this.run===run)this.run=undefined;}
    })();
    return run.promise;
  }
  cancel(): void {const run=this.run;this.run=undefined;run?.controller.abort(new DOMException("Canonical owner cancelled","AbortError"));}
  dispose(): void {this.disposed=true;this.cancel();this.records.clear();this.current={chunks:[],completed:[]};}
}
