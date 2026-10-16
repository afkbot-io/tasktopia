import type { ChunkDto,ChunkTaskDto } from "../shared/contracts";

type CityData={chunks:readonly ChunkDto[];completed:readonly ChunkTaskDto[]};

/** One coherent physical snapshot; unfinished worker pages never remove part
 * of the city's walking network. No historical snapshots or viewport scope. */
export class CanonicalCityData {
  private snapshot:CityData={chunks:[],completed:[]};
  pending=false;
  resolve(coordinates:readonly {chunkX:number;chunkY:number}[],read:(x:number,y:number)=>ChunkDto|undefined,completed:readonly ChunkTaskDto[]):CityData {
    const chunks=coordinates.flatMap(coordinate=>{const chunk=read(coordinate.chunkX,coordinate.chunkY);return chunk?[chunk]:[];});
    this.pending=chunks.length!==coordinates.length;
    if(!this.pending)this.snapshot={chunks,completed};
    return this.snapshot;
  }
}
