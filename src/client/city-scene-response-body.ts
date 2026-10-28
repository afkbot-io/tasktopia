import { decodeCitySceneWire } from "../shared/city-scene-wire";
import { SAFE_HTTP_ERROR_MESSAGES } from "../shared/http-errors";
import { estimateCitySceneDataWeight } from "../shared/city-scene-weight";
import type { SceneResponseMessage } from "./city-scene-response";
import { CITY_SCENE_RESPONSE_BYTE_LIMIT } from "./city-scene-response-limit";

/** Fetch exposes decompressed bytes, so this bound also covers gzip responses. */
export async function readCitySceneText(response:Response,limit=CITY_SCENE_RESPONSE_BYTE_LIMIT):Promise<{text:string;bytes:number}>{
  if(!response.body)return{text:"",bytes:0};
  const reader=response.body.getReader(),decoder=new TextDecoder(),parts:string[]=[];
  let bytes=0,complete=false;
  try{
    for(;;){
      const next=await reader.read();
      if(next.done){complete=true;break;}
      bytes+=next.value.byteLength;
      if(bytes>limit)throw new Error("Сцена города слишком велика для загрузки");
      parts.push(decoder.decode(next.value,{stream:true}));
    }
    parts.push(decoder.decode());
    return{text:parts.join(""),bytes};
  }finally{
    if(!complete)try{await reader.cancel();}catch{/* Preserve the original read failure. */}
    reader.releaseLock();
  }
}

export async function decodeCitySceneResponse(response:Response,started:number,headersAtEpoch:number):Promise<SceneResponseMessage>{
  const textStarted=performance.now();
  let raw:{text:string;bytes:number};
  try{raw=await readCitySceneText(response,response.ok?CITY_SCENE_RESPONSE_BYTE_LIMIT:64*1024);}
  catch(error){
    if(response.ok)throw error;
    return{error:{status:response.status,message:SAFE_HTTP_ERROR_MESSAGES[response.status]??`Ошибка HTTP ${response.status}`}};
  }
  const received=performance.now(),parseStarted=received;
  let input:unknown;
  try{input=raw.text?JSON.parse(raw.text):{};}catch{
    if(response.ok)throw new Error("Сервер вернул повреждённую сцену города");
  }
  if(!response.ok){
    const message=input&&typeof input==="object"&&"message" in input&&typeof input.message==="string"?input.message:undefined;
    return{error:{status:response.status,message:message??SAFE_HTTP_ERROR_MESSAGES[response.status]??`Ошибка HTTP ${response.status}`}};
  }
  const parsed=performance.now(),scene=decodeCitySceneWire(input),decoded=performance.now();
  const retainedWeight=estimateCitySceneDataWeight(scene),weighed=performance.now();
  const headers:Array<[string,string]>=[];
  for(const name of ["x-tasktopia-server-time","cache-control","age"]){const value=response.headers.get(name);if(value!==null)headers.push([name,value]);}
  return{scene,headers,metrics:{decodedBytes:raw.bytes,requestMs:received-started,parseMs:parsed-parseStarted,decodeMs:decoded-parsed,
    retainedWeight,weightMs:weighed-decoded,textMs:received-textStarted,headersAtEpoch}};
}
