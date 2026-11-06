import type {CellRunDto} from '../shared/contracts';

export type CitySceneRunReader={read():CellRunDto[]};
const owners=new WeakMap<object,Map<string,CitySceneRunReader>>();

/** The scene owns the small reader, never its weakly memoized run forest.
 * Getters remain ordinary cloneable data at the worker boundary. */
export function bindCitySceneRunField(target:object,key:string,reader:CitySceneRunReader):void{
  let fields=owners.get(target);if(!fields){fields=new Map();owners.set(target,fields);}fields.set(key,reader);
  Object.defineProperty(target,key,{enumerable:true,configurable:true,
    get(){return reader.read();},
    set(this:object,value:unknown){
      const fields=owners.get(this);fields?.delete(key);if(!fields?.size)owners.delete(this);
      Object.defineProperty(this,key,{value,enumerable:true,configurable:true,writable:true});
    },
  });
}

/** Metadata replacement must not invoke untouched geometry getters. Plain
 * legacy objects retain their original spread semantics. */
export function copyCitySceneRunFields<T extends object>(source:T,changes:Partial<T>):T{
  const fields=owners.get(source);if(!fields?.size)return {...source,...changes};
  const next=Object.defineProperties({}, {...Object.getOwnPropertyDescriptors(source),...Object.getOwnPropertyDescriptors(changes)}) as T;
  const retained=new Map([...fields].filter(([key])=>!Object.hasOwn(changes,key)));
  if(retained.size)owners.set(next,retained);
  return next;
}
