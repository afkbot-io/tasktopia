/** One immutable canonical preparation at a time. Old work cannot publish into
 * a newer topology, hidden owner or disposed canvas, even if it ignores abort. */
export class CityMovementPreparation {
  private pending:{key:string;controller:AbortController;promise:Promise<boolean>}|undefined;
  private disposed=false;
  constructor(private readonly timeoutMs=20_000){}
  get busy():boolean{return !!this.pending;}

  request<T>(key:string,work:(signal:AbortSignal)=>Promise<T>,commit:(value:T)=>void,valid:()=>boolean=()=>true):Promise<boolean>{
    if(this.disposed)return Promise.resolve(false);
    if(this.pending?.key===key)return this.pending.promise;
    this.cancel();
    const controller=new AbortController(),run={key,controller,promise:Promise.resolve(false)};
    this.pending=run;
    run.promise=(async()=>{
      let timer:ReturnType<typeof setTimeout>|undefined;
      let aborted:(()=>void)|undefined;
      try{
        const value=await new Promise<T>((resolve,reject)=>{
          aborted=()=>reject(controller.signal.reason??new DOMException("Movement preparation cancelled","AbortError"));
          controller.signal.addEventListener("abort",aborted,{once:true});
          timer=setTimeout(()=>controller.abort(new Error("Подготовка движения занимает слишком долго. Повторите загрузку города.")),this.timeoutMs);
          Promise.resolve().then(()=>{
            controller.signal.throwIfAborted();return work(controller.signal);
          }).then(resolve,reject);
        });
        if(this.disposed||this.pending!==run||controller.signal.aborted||!valid())return false;
        commit(value);return true;
      }catch(error){
        if(controller.signal.aborted&&controller.signal.reason instanceof DOMException&&controller.signal.reason.name==="AbortError")return false;
        throw error;
      }finally{
        clearTimeout(timer);if(aborted)controller.signal.removeEventListener("abort",aborted);
        if(this.pending===run)this.pending=undefined;
      }
    })();
    return run.promise;
  }
  cancel():void{const run=this.pending;this.pending=undefined;run?.controller.abort(new DOMException("Movement owner cancelled","AbortError"));}
  dispose():void{this.disposed=true;this.cancel();}
}

/** Status/role changes do not discard a prepared physical network. Only its
 * small semantic plan retries; the owner still fences the final atomic turn. */
export async function prepareLatestCityLife<S,T>(
  read:()=>{revision:number;state:S},
  prepare:(state:S,signal:AbortSignal)=>Promise<T>,
  signal:AbortSignal,
):Promise<{revision:number;value:T}>{
  for(;;){
    signal.throwIfAborted();
    const current=read(),value=await prepare(current.state,signal);
    signal.throwIfAborted();
    if(read().revision===current.revision)return{revision:current.revision,value};
  }
}
