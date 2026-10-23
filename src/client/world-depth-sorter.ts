import { compareWorldObjects, type WorldObjectDepth, type WorldObjectKind } from "./world-object-depth";

/** Publish through Pixi's supported depth API so cached render instructions see
 * crossings. Keep the caller's custom sorting ownership: an appended child has
 * a default zIndex until the next crossing and must not be reordered by Pixi. */
export function applyWorldDepthOrder(layer:{sortableChildren:boolean;sortChildren():void},ordered:readonly {zIndex:number}[]):void {
  const sortableChildren=layer.sortableChildren;
  try {
    // Append/removal may leave historical ordinals equal to the new order.
    // Force one supported setter change even when all final setters are no-ops.
    const first=ordered[0];
    if(first)first.zIndex=first.zIndex===-1?-2:-1;
    for(let index=0;index<ordered.length;index++)ordered[index]!.zIndex=index;
    layer.sortChildren();
  } finally {
    layer.sortableChildren=sortableChildren;
  }
}

/** Cache descriptors instead of allocating two records per comparison. Static
 * layers need no repeat sort; one live descriptor per object is weakly owned. */
export class WorldDepthSorter<T extends {y:number;label:string}> {
  private readonly records = new WeakMap<T,WorldObjectDepth & {index:number}>();
  private count = -1;
  // Renderers with cached draw instructions must publish a changed order through
  // their depth API. The callback receives the sorted array only on a crossing;
  // descriptor changes alone must not invalidate the renderer's structure.
  sort(objects:T[],kindOf:(object:T)=>WorldObjectKind,audit=true,onOrderChanged?:(ordered:readonly T[])=>void):{changed:boolean;errors?:number} {
    let changed = objects.length !== this.count;
    this.count = objects.length;
    for (let index=0;index<objects.length;index++) {
      const object=objects[index]!;
      const kind = kindOf(object), record = this.records.get(object);
      if (!record) { this.records.set(object,{groundY:object.y,kind,id:object.label,index}); changed = true; }
      else if (record.groundY !== object.y || record.kind !== kind || record.id !== object.label) {
        record.groundY = object.y; record.kind = kind; record.id = object.label; changed = true;
      }
      if(record && record.index!==index)changed=true;
      if(record)record.index=index;
    }
    const compare = (a:T,b:T) => compareWorldObjects(this.records.get(a)!,this.records.get(b)!);
    if (changed) {
      objects.sort(compare);
      let orderChanged=false;
      for(let index=0;index<objects.length;index++)if(this.records.get(objects[index]!)!.index!==index){orderChanged=true;break;}
      if(orderChanged)onOrderChanged?.(objects);
      for(let index=0;index<objects.length;index++)this.records.get(objects[index]!)!.index=index;
    }
    if (!audit) return {changed};
    let errors = 0;
    for (let index=1;index<objects.length;index++) if(compare(objects[index-1]!,objects[index]!)>0) errors++;
    return {changed,errors};
  }
}
