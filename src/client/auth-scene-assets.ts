export type AuthSceneImage = Pick<HTMLImageElement, 'src' | 'onload' | 'onerror' | 'removeAttribute' | 'decoding' | 'fetchPriority'>;
export type AuthSceneAssetState<T extends AuthSceneImage> = {
  loaded: ReadonlyMap<string,T>; total: number; pending: number; failed: number; timedOut: number;
};

/** Decorative resources only; authentication never awaits this loader. */
export function loadAuthSceneAssets<T extends AuthSceneImage>({urls,imageFactory,onProgress}:{
  urls:readonly string[]; imageFactory:()=>T; onProgress:(state:AuthSceneAssetState<T>)=>void;
}) {
  const sources=[...new Set(urls)],loaded=new Map<string,T>();
  const records=new Map<string,{image:T;timer:ReturnType<typeof setTimeout>}>();
  let pending=sources.length,failed=0,timedOut=0,disposed=false,closing=false,pumping=false,next=0;
  let deadline:ReturnType<typeof setTimeout>|undefined;
  const publish=()=>{if(!disposed)onProgress({loaded:new Map(loaded),total:sources.length,pending,failed,timedOut});};
  const finish=(url:string,image:T,result:'loaded'|'failed'|'timedOut')=>{
    const record=records.get(url);if(disposed||!record)return;
    clearTimeout(record.timer);records.delete(url);
    image.onload=null;image.onerror=null;pending--;
    if(result==='loaded')loaded.set(url,image);
    else {failed++;if(result==='timedOut')timedOut++;image.removeAttribute('src');}
    if(pending===0&&deadline!==undefined){clearTimeout(deadline);deadline=undefined;}
    publish();
    pump();
  };
  const pump=()=>{
    if(disposed||closing||pumping)return;pumping=true;
    try {while(records.size<4&&next<sources.length){
      const url=sources[next++]!,image=imageFactory();
      image.decoding='async';image.fetchPriority='low';
      image.onload=()=>finish(url,image,'loaded');image.onerror=()=>finish(url,image,'failed');
      records.set(url,{image,timer:setTimeout(()=>finish(url,image,'timedOut'),3000)});
      image.src=url;
    }} finally {pumping=false;}
  };
  publish();
  if(pending>0)deadline=setTimeout(()=>{
    closing=true;
    for(const [url,{image}] of records)finish(url,image,'timedOut');
    const queued=sources.length-next;next=sources.length;pending-=queued;failed+=queued;timedOut+=queued;
    deadline=undefined;publish();
  },6000);
  pump();
  return ()=>{
    disposed=true;if(deadline!==undefined)clearTimeout(deadline);
    for(const {image,timer} of records.values()){clearTimeout(timer);image.onload=null;image.onerror=null;image.removeAttribute('src');}
    records.clear();for(const image of loaded.values())image.removeAttribute('src');loaded.clear();
  };
}
