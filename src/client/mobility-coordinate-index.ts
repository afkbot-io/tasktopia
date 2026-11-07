/** Private compiled lookup. Coordinates belong to the immutable CSR snapshot,
 * so the common integer grid needs neither another string key nor a Map node. */
export type MobilityCoordinateIndex = {
  at(x:number,y:number):number|undefined;
  get(id:string):number|undefined;
  entries():IterableIterator<[string,number]>;
};
const MAX_PROBES=64,MAX_TYPED_NODES=8_388_608;
const integer=(n:number)=>Number.isInteger(n)&&n>=-2_147_483_648&&n<=2_147_483_647;
const hash=(x:number,y:number)=>{
  let value=Math.imul(x,0x9e3779b1)^Math.imul(y,0x85ebca77);
  value=Math.imul(value^(value>>>16),0x7feb352d);
  value=Math.imul(value^(value>>>15),0x846ca68b);return(value^(value>>>16))>>>0;
};
class TypedCoordinateIndex implements MobilityCoordinateIndex {
  constructor(private readonly coordinates:Float64Array,private readonly count:number,private readonly slots:Uint32Array){}
  at(x:number,y:number):number|undefined{
    if(!integer(x)||!integer(y))return;
    const mask=this.slots.length-1,first=hash(x,y)&mask;
    for(let n=0;n<MAX_PROBES;n++){
      const stored=this.slots[(first+n)&mask]!;if(!stored)return;
      const index=stored-1;if(this.coordinates[index*2]===x&&this.coordinates[index*2+1]===y)return index;
    }
  }
  get(id:string):number|undefined{
    const comma=id.indexOf(',');if(comma<1)return;
    const x=Number(id.slice(0,comma)),y=Number(id.slice(comma+1));
    // Public adjacency and closures use exact canonical string keys. Do not
    // turn whitespace, -0, exponents or empty coordinates into valid keys.
    if(id!==`${x},${y}`)return;return this.at(x,y);
  }
  *entries():Generator<[string,number],undefined,unknown>{
    for(let i=0;i<this.count;i++)yield[`${this.coordinates[i*2]},${this.coordinates[i*2+1]}`,i];
    return undefined;
  }
}
class StringCoordinateIndex implements MobilityCoordinateIndex {
  constructor(private readonly indices:ReadonlyMap<string,number>){}
  at(x:number,y:number){return this.indices.get(`${x},${y}`);}
  get(id:string){return this.indices.get(id);}
  entries(){return this.indices.entries();}
}
export function* mobilityCoordinateIndexSteps(coordinates:Float64Array,count:number,sourceKeys?:ReadonlyMap<number,string>):Generator<void,MobilityCoordinateIndex,void>{
  let capacity=1;while(capacity<count*2&&count<=MAX_TYPED_NODES)capacity*=2;
  const slots=count<=MAX_TYPED_NODES&&!sourceKeys?.size?new Uint32Array(capacity):undefined;
  let supported=!!slots;
  if(slots)for(let i=0;i<count;i++){
    const x=coordinates[i*2]!,y=coordinates[i*2+1]!;let inserted=false;
    if(integer(x)&&integer(y)){
      const first=hash(x,y)&(capacity-1);
      for(let n=0;n<MAX_PROBES;n++){
        const slot=(first+n)&(capacity-1),stored=slots[slot]!;
        if(!stored){slots[slot]=i+1;inserted=true;break;}
        // Duplicate source values retain the old Map's first-key order and
        // last index. They are uncommon custom graphs, so use that Map whole.
        if(coordinates[(stored-1)*2]===x&&coordinates[(stored-1)*2+1]===y)break;
      }
    }
    yield;
    if(!inserted){supported=false;break;}
  }
  if(supported)return new TypedCoordinateIndex(coordinates,count,slots!);
  const indices=new Map<string,number>();
  for(let i=0;i<count;i++){indices.set(sourceKeys?.get(i)??`${coordinates[i*2]},${coordinates[i*2+1]}`,i);yield;}
  return new StringCoordinateIndex(indices);
}
