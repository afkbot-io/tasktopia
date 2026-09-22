import { Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import { CITY_LIFE_LABEL, type CityLifeScene } from './city-life';
import { microAmbientSprite, microDirection } from '../shared/micro-ambient';

/** All actors reuse authored native people; only tiny activity cues are drawn.
 * This layer has no hit targets and can never consume task/map interaction. */
export function createCityLifeView(textureFor:(url:string)=>Texture|undefined) {
  const root=new Container({eventMode:'none',label:'city-life'});
  const person=new Sprite({eventMode:'none',roundPixels:true});person.anchor.set(.5);
  const cue=new Graphics({eventMode:'none'});
  const caption=new Text({text:'',resolution:2,style:{fontFamily:'Arial, sans-serif',fontSize:7,fill:0xf0e6bd,fontWeight:'600'}});
  caption.anchor.set(.5,1);
  const plate=new Graphics({eventMode:'none'});
  root.addChild(person,cue,plate,caption);root.visible=false;
  let identity='',lastFrame=-1;
  return {root,update(scene:CityLifeScene|undefined,now:number) {
    root.visible=Boolean(scene);if(!scene)return;
    const route=scene.route,step=Math.min(route.length-2,Math.floor(scene.progress*(route.length-1)));
    const direction=scene.phase==='ACTIVITY'?'south':scene.phase==='LEAVING'?microDirection(route[step+1]!,route[step]!):microDirection(route[step]!,route[step+1]!);
    const texture=textureFor(microAmbientSprite('person',scene.kind==='GARDEN'||scene.kind==='MUSIC'?'teal':'ochre',direction).url);
    if(texture)person.texture=texture;
    person.position.set(Math.round((scene.position.x+.5)*8),Math.round((scene.position.y+.5)*8));
    const anchor=route.at(-1)!;cue.position.set((anchor.x+.5)*8,(anchor.y+.5)*8);
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
    const active=scene.phase==='ACTIVITY';cue.visible=active;caption.visible=active;plate.visible=active;
    if(caption.text!==CITY_LIFE_LABEL[scene.kind]) {
      caption.text=CITY_LIFE_LABEL[scene.kind];
      plate.clear().rect(-caption.width/2-3,-caption.height-2,caption.width+6,caption.height+4).fill({color:0x183932,alpha:.88});
    }
    caption.position.set((anchor.x+.5)*8,(anchor.y+.5)*8-10);plate.position.copyFrom(caption.position);
    const elapsed=now-scene.start;person.alpha=Math.min(1,elapsed/650,(scene.durationMs-elapsed)/650);
  }};
}
