import { Container, Graphics } from 'pixi.js';
import type { CityLifeScene } from './city-life';
import { cityLifeCueFrame, type CityLifeCueFrame } from './city-life-cues';

/** All actors reuse authored native people; only tiny activity cues are drawn.
 * This layer has no hit targets and can never consume task/map interaction. */
export function createCityLifeView() {
  const root=new Container({eventMode:'none',label:'city-life'});
  const cue=new Graphics({eventMode:'none'});
  root.addChild(cue);root.visible=false;
  let identity='',lastFrame=-1;
  return {root,update(scene:CityLifeScene|undefined,now:number):CityLifeCueFrame|undefined {
    root.visible=Boolean(scene);if(!scene)return;
    const x=Math.round(scene.position.x*8),y=Math.round(scene.position.y*8);
    if(root.x!==x||root.y!==y)root.position.set(x,y);
    if(scene.recipeId){
      const state=cityLifeCueFrame(scene,now);cue.visible=!!state;
      if(state){
        const next=`${scene.id}:${scene.phase}:${state.action}:${state.step}`;
        if(identity!==next||lastFrame!==state.frame){
          identity=next;lastFrame=state.frame;cue.clear();
          for(const pixel of state.pixels)cue.rect(pixel.x,pixel.y,pixel.width,pixel.height).fill(pixel.color);
        }
      }
      return state;
    }
    const frame=Math.floor(now/600)%2;
    if(identity!==scene.id||lastFrame!==frame) {
      identity=scene.id;lastFrame=frame;cue.clear();
      if(scene.kind==='MOVING'||scene.kind==='DELIVERY') cue.rect(3,-1,3,3).fill(0xb99661).rect(4,-1,1,3).fill(0xe0c88e);
      if(scene.kind==='GARDEN') cue.rect(3,0,3,2).fill(0x6d9a83).rect(6,-1,1,1).fill(0x9ac7ce).rect(7,frame,1,1).fill(0x9ac7ce);
      if(scene.kind==='MUSIC') cue.rect(3,-3-frame,1,4).rect(2,-frame,1,1).rect(4,-3-frame,2,1).fill(0xe5c679);
      if(scene.kind==='CELEBRATION') cue.rect(-4,-7,9,1).fill(0xb9ab82).rect(-4,-6,2,2).fill(0xd79565).rect(3,-6,2,2).fill(0x7bada2);
      if(scene.kind==='CLEANING') cue.rect(3+frame,-2,1,5).fill(0xbaa277).rect(2+frame,2,3,1).fill(0xc6bb81);
      if(scene.kind==='MAINTENANCE') cue.rect(3,-5,1,8).rect(6,-5,1,8).rect(4,-3,2,1).rect(4,0,2,1).fill(0xc8b889);
      if(scene.kind==='DRILL') cue.rect(3,1,3,1).fill(0xd0955e).rect(4,-1,1,2).fill(0xebc982);
    }
    cue.visible=scene.phase==='ACTIVITY'||scene.phase==='ARRIVING'&&(scene.kind==='MOVING'||scene.kind==='DELIVERY');
  }};
}
