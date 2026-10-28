import { decodeCitySceneResponse } from "./city-scene-response-body";
import { packCitySceneTransfer } from "./city-scene-transfer";
import type { SceneResponseMessage, SceneResponseRequest } from "./city-scene-response";

const scope=self as unknown as {onmessage:((event:MessageEvent<SceneResponseRequest>)=>void)|null;postMessage(value:SceneResponseMessage,transfer?:Transferable[]):void};
scope.onmessage=event=>{
  const request=event.data;
  const body=[204,205,304].includes(request.status)?null:request.body;
  void Promise.resolve().then(()=>decodeCitySceneResponse(new Response(body,{status:request.status,headers:request.headers}),
    request.startedEpoch-performance.timeOrigin,request.headersAtEpoch))
    .then(value=>{
      if(!value.scene){scope.postMessage(value);return;}
      const {scene,...rest}=value,started=performance.now(),transfer=packCitySceneTransfer(scene);
      const metrics=value.metrics?{...value.metrics,packMs:performance.now()-started}:undefined;
      scope.postMessage({...rest,metrics,transfer},[transfer.coordinates.buffer as ArrayBuffer,transfer.metadataIndices.buffer as ArrayBuffer]);
    })
    .catch(error=>scope.postMessage({error:{message:error instanceof Error?error.message:"Не удалось загрузить сцену города"}}));
};
