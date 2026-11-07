import {expect,it,vi} from 'vitest';
import {Container,Sprite,Texture} from 'pixi.js';
import {createCityTransportFurnitureView} from '../src/client/city-transport-furniture-view';
import type {CityTransportFurniture} from '../src/shared/city-transport-furniture';
const item:CityTransportFurniture={id:'air:wind',taskId:'air',kind:'airport-windsock',origin:{x:10,y:20}};
it('retains upright furniture without per-frame texture/position work, with native ground registration',()=>{
  const parent=new Container(),texture=vi.fn(()=>Texture.EMPTY),view=createCityTransportFurnitureView(texture,s=>parent.addChild(s));
  try{
    expect(view.update([item])).toEqual({total:1,visible:1});const sprite=parent.children[0] as Sprite;
    expect([sprite.x,sprite.y,sprite.anchor.x,sprite.anchor.y,sprite.rotation]).toEqual([84,168,.5,1,0]);
    const position=vi.spyOn(sprite.position,'set');texture.mockClear();
    for(let i=0;i<120;i++)view.update([{...item,origin:{...item.origin}}]);
    expect(texture).not.toHaveBeenCalled();expect(position).not.toHaveBeenCalled();expect(parent.children[0]).toBe(sprite);
  }finally{view.destroy();expect(parent.children).toHaveLength(0);parent.destroy();}
});
it('retries missing atlas art with the same sprite, and destroys a removed owner',()=>{
  let ready=false;const parent=new Container(),view=createCityTransportFurnitureView(()=>ready?Texture.EMPTY:undefined,s=>parent.addChild(s));
  try{
    expect(view.update([item])).toEqual({total:1,visible:0});const sprite=parent.children[0]!;
    ready=true;expect(view.update([item])).toEqual({total:1,visible:1});expect(parent.children[0]).toBe(sprite);
    expect(view.update([])).toEqual({total:0,visible:0});expect(sprite.destroyed).toBe(true);
  }finally{view.destroy();parent.destroy();}
});
