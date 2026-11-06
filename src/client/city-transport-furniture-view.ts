import {Sprite,type Texture} from 'pixi.js';
import type {CityTransportFurniture} from '../shared/city-transport-furniture';

/** Permanent, source-authored furniture: no actor, LOD or animation owner. */
export function createCityTransportFurnitureView(texture:(key:string)=>Texture|undefined,attach:(sprite:Sprite)=>void){
  const records=new Map<string,{sprite:Sprite;kind:string;ready:boolean}>();
  let signature='',complete=false,counts={total:0,visible:0};
  return {
    update(props:readonly CityTransportFurniture[]){
      const next=JSON.stringify(props);
      if(next===signature&&complete)return counts;
      const wanted=new Set(props.map(prop=>prop.id));
      for(const [id,record] of records)if(!wanted.has(id)){record.sprite.destroy();records.delete(id);}
      complete=true;let visible=0;
      for(const prop of props){
        let record=records.get(prop.id);
        if(!record){const sprite=new Sprite({label:prop.id,eventMode:'none',roundPixels:true});sprite.anchor.set(.5,1);sprite.visible=false;
          record={sprite,kind:prop.kind,ready:false};records.set(prop.id,record);attach(sprite);}
        if(record.kind!==prop.kind){record.kind=prop.kind;record.ready=false;}
        const loaded=texture(prop.kind);if(loaded){record.sprite.texture=loaded;record.ready=true;}
        const x=(prop.origin.x+.5)*8,y=(prop.origin.y+1)*8;
        if(record.sprite.x!==x||record.sprite.y!==y)record.sprite.position.set(x,y);
        record.sprite.visible=record.ready;if(record.ready)visible++;else complete=false;
      }
      signature=next;counts={total:records.size,visible};return counts;
    },
    destroy(){for(const {sprite} of records.values())sprite.destroy();records.clear();signature='';complete=false;counts={total:0,visible:0};},
  };
}
