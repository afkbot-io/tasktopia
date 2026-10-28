import { decodeCitySceneResponse } from "./city-scene-response-body";
import type { SceneResponseMessage, SceneResponseRequest } from "./city-scene-response";

const scope=self as unknown as {onmessage:((event:MessageEvent<SceneResponseRequest>)=>void)|null;postMessage(value:SceneResponseMessage):void};
scope.onmessage=event=>{
  const request=event.data;
  const body=[204,205,304].includes(request.status)?null:request.body;
  void Promise.resolve().then(()=>decodeCitySceneResponse(new Response(body,{status:request.status,headers:request.headers}),
    request.startedEpoch-performance.timeOrigin,request.headersAtEpoch))
    .then(value=>scope.postMessage(value))
    .catch(error=>scope.postMessage({error:{message:error instanceof Error?error.message:"Не удалось загрузить сцену города"}}));
};
