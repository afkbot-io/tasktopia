/** Conservative retained-heap estimate, including shared decoded task data. */
export const CITY_SCENE_DATA_BUDGET=48*1024*1024;
export function estimateCitySceneDataWeight(scene:unknown):number{
  let weight=0;const seen=new WeakSet<object>();
  const visit=(value:unknown):void=>{
    if(weight>CITY_SCENE_DATA_BUDGET)return;
    if(typeof value==='string'){weight+=value.length*2+24;return;}
    if(!value||typeof value!=='object'){weight+=8;return;}
    if(seen.has(value))return;seen.add(value);weight+=64;
    if(Array.isArray(value)){for(const item of value){visit(item);if(weight>CITY_SCENE_DATA_BUDGET)break;}}
    else for(const name in value){weight+=name.length*2+16;visit((value as Record<string,unknown>)[name]);if(weight>CITY_SCENE_DATA_BUDGET)break;}
  };
  visit(scene);return weight;
}
