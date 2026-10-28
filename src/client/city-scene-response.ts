import type { CitySceneDto } from "../shared/city-scene-contract";
import { ApiError } from "./api";
import { synchronizeWorldClock } from "./server-world-clock";
import { CITY_SCENE_COMPACT_ACCEPT } from "../shared/city-scene-wire";
import { readCitySceneBytes } from "./city-scene-response-bytes";

export type SceneResponseMetrics={decodedBytes:number;requestMs:number;parseMs:number;decodeMs:number;headersAtEpoch:number;retainedWeight?:number;weightMs?:number;
  textMs?:number;fetchHeadersMs?:number;bodyReadMs?:number;workerRoundTripMs?:number;ownerMs?:number};
export type SceneResponseMessage = {scene?:CitySceneDto;metrics?:SceneResponseMetrics;headers?:Array<[string,string]>;error?:{status?:number;message:string}};
export type SceneResponseRequest={body:ArrayBuffer;status:number;headers:Array<[string,string]>;startedEpoch:number;headersAtEpoch:number};
export type SceneResponseWorker = {
  addEventListener(type:"message",listener:(event:MessageEvent<SceneResponseMessage>)=>void):void;
  addEventListener(type:"error",listener:(event:ErrorEvent)=>void):void;
  removeEventListener(type:"message",listener:(event:MessageEvent<SceneResponseMessage>)=>void):void;
  removeEventListener(type:"error",listener:(event:ErrorEvent)=>void):void;
  postMessage(message:SceneResponseRequest,transfer:Transferable[]):void;
  terminate():void;
};

const metrics=new WeakMap<CitySceneDto,SceneResponseMetrics>();
export const citySceneResponseMetrics=(scene:CitySceneDto)=>metrics.get(scene);
const browserWorker=async(signal:AbortSignal):Promise<SceneResponseWorker>=>{
  const {default:workerAssetUrl}=await import("./city-scene-response-worker.ts?worker&url");
  signal.throwIfAborted();
  const url=new URL(workerAssetUrl,location.origin);url.protocol=location.protocol;url.host=location.host;
  return new Worker(url,{type:"module"});
};

/** The page owns network observability; its worker owns all text/DTO decoding. */
export function loadCitySceneResponse(path:string,signal:AbortSignal,factory?:()=>SceneResponseWorker|Promise<SceneResponseWorker>,fetcher:typeof fetch=fetch):Promise<CitySceneDto>{
  if(signal.aborted)return Promise.reject(signal.reason??new DOMException("Scene read cancelled","AbortError"));
  if(!/^\/api\/countries\/[^/?#]+\/cities\/[^/?#]+\/scene$/.test(path))return Promise.reject(new Error("Некорректный адрес сцены города"));
  const ownerStartedAt=performance.now();
  let requestStartedAt=0,headersReceivedAt=0,bodyReadAt=0,workerPostedAt=0;
  return new Promise((resolve,reject)=>{
    let worker:SceneResponseWorker|undefined,settled=false;
    const io=new AbortController();let ioComplete=false;
    const finish=(action:()=>void)=>{
      if(settled)return;settled=true;
      if(!ioComplete)io.abort();
      signal.removeEventListener("abort",abort);
      worker?.removeEventListener("message",message);worker?.removeEventListener("error",error);
      worker?.terminate();action();
    };
    const abort=()=>finish(()=>reject(signal.reason??new DOMException("Scene read cancelled","AbortError")));
    const error=(event:ErrorEvent)=>finish(()=>reject(new Error(event.message||"Не удалось загрузить сцену города")));
    const message=(event:MessageEvent<SceneResponseMessage>)=>{
      const value=event.data;
      if(value?.error){
        const failure=typeof value.error.status==="number"?new ApiError(value.error.status,value.error.message):new Error(value.error.message);
        finish(()=>reject(failure));return;
      }
      if(!value?.scene){finish(()=>reject(new Error("Сервер вернул несовместимую сцену города")));return;}
      if(value.metrics){
        const receivedAt=performance.now();
        metrics.set(value.scene,{...value.metrics,fetchHeadersMs:headersReceivedAt-requestStartedAt,
          bodyReadMs:bodyReadAt-headersReceivedAt,workerRoundTripMs:receivedAt-workerPostedAt,ownerMs:receivedAt-ownerStartedAt});
        if(value.headers)synchronizeWorldClock(new Headers(value.headers),requestStartedAt,value.metrics.headersAtEpoch-performance.timeOrigin);
      }
      finish(()=>resolve(value.scene!));
    };
    const attach=(created:SceneResponseWorker)=>{
      if(settled||signal.aborted){created.terminate();if(!settled)abort();return;}
      worker=created;
      try{
        worker.addEventListener("message",message);worker.addEventListener("error",error);
        void (async()=>{
          requestStartedAt=performance.now();
          const response=await fetcher(path,{credentials:"include",cache:"no-cache",signal:io.signal,headers:{accept:CITY_SCENE_COMPACT_ACCEPT}});
          headersReceivedAt=performance.now();
          const headersAtEpoch=performance.timeOrigin+headersReceivedAt;
          const body=await readCitySceneBytes(response,io.signal);
          io.signal.throwIfAborted();ioComplete=true;bodyReadAt=performance.now();
          workerPostedAt=performance.now();
          worker!.postMessage({body,status:response.status,headers:[...response.headers],startedEpoch:performance.timeOrigin+requestStartedAt,headersAtEpoch},[body]);
        })().catch(failure=>finish(()=>reject(failure)));
      }
      catch(failure){finish(()=>reject(failure));}
    };
    try{
      signal.addEventListener("abort",abort,{once:true});
      if(signal.aborted){abort();return;}
      const created=factory?factory():browserWorker(signal);
      if("then" in created)void created.then(attach,failure=>finish(()=>reject(failure)));
      else attach(created);
    }catch(failure){finish(()=>reject(failure));}
  });
}
