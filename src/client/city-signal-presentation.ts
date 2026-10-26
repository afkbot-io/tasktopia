import type { Cell, Rect } from "../shared/contracts";
type SignalGeometry={readonly id:string;readonly signalPosts:readonly {readonly approach:"N"|"E"|"S"|"W";readonly axis:"H"|"V"}[]};

export type CitySignalPlacement = {
  id:string; signalIndex:number; axis:"H"|"V"; x:number; y:number;
  bounds:Rect;
};

/** Physical signals remain canonical. Only their immutable presentation is
 * paged, including the complete sprite and the previous coherent camera halo. */
export function createCitySignalPresentation(signals:readonly SignalGeometry[],origins:ReadonlyMap<string,Cell>,
  roads:ReadonlyMap<string,Cell>,artwork:{width:number;height:number}) {
  const placements:CitySignalPlacement[]=[];
  for(let signalIndex=0;signalIndex<signals.length;signalIndex++)for(const post of signals[signalIndex]!.signalPosts){
    const id=`${signals[signalIndex]!.id}:${post.approach}`,origin=origins.get(id);
    if(!origin)continue; // Never invent a support for a physically rejected post.
    const x=origin.x+(roads.has(`${origin.x+1},${origin.y}`)?.8:.2),y=origin.y+.8;
    placements.push({id,signalIndex,axis:post.axis,x,y,
      bounds:{minX:x-artwork.width/2,maxX:x+artwork.width/2,minY:y-artwork.height,maxY:y}});
  }
  let current:Rect|undefined,previous:Rect|undefined,result:readonly CitySignalPlacement[]=placements;
  const intersects=(sprite:Rect,area:Rect)=>sprite.maxX>=area.minX&&sprite.minX<=area.maxX+1
    &&sprite.maxY>=area.minY&&sprite.minY<=area.maxY+1;
  return {
    total:placements.length,
    resident(bounds?:Rect,presented?:Rect):readonly CitySignalPlacement[]{
      if(bounds===current&&presented===previous)return result;
      current=bounds;previous=presented;
      result=!bounds&&!presented?placements:placements.filter(p=>!!bounds&&intersects(p.bounds,bounds)||!!presented&&intersects(p.bounds,presented));
      return result;
    },
  };
}
