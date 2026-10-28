import { yieldPreparationTask } from "./cooperative-preparation";
import { CITY_SCENE_RESPONSE_BYTE_LIMIT } from "./city-scene-response-limit";

/** Only binary IO lives on the page. UTF8/JSON/geometry stay in its worker. */
export async function readCitySceneBytes(response:Response,signal:AbortSignal,limit=CITY_SCENE_RESPONSE_BYTE_LIMIT):Promise<ArrayBuffer>{
  signal.throwIfAborted();
  if(!response.body)return new ArrayBuffer(0);
  const reader=response.body.getReader(),parts:Uint8Array[]=[];
  let size=0,complete=false,slice=performance.now();
  const aborted=()=>{void reader.cancel(signal.reason).catch(()=>undefined);};
  signal.addEventListener("abort",aborted,{once:true});
  try{
    for(;;){
      const next=await reader.read();signal.throwIfAborted();
      if(next.done){complete=true;break;}
      size+=next.value.byteLength;
      if(size>limit)throw new Error("Сцена города слишком велика для загрузки");
      parts.push(next.value);
      if(performance.now()-slice>=4){await yieldPreparationTask(signal);slice=performance.now();}
    }
    const result=new Uint8Array(size);let offset=0;
    for(const part of parts){
      signal.throwIfAborted();result.set(part,offset);offset+=part.byteLength;
      if(performance.now()-slice>=4){await yieldPreparationTask(signal);slice=performance.now();}
    }
    return result.buffer;
  }finally{
    signal.removeEventListener("abort",aborted);
    if(!complete)try{await reader.cancel();}catch{/* Preserve the original read failure. */}
    reader.releaseLock();
  }
}
