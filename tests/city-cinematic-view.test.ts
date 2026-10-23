import { expect, it, vi } from 'vitest';
import { Container, Graphics, Texture } from 'pixi.js';
import { createCityCinematicView } from '../src/client/city-cinematic-view';
import type { ChunkTaskDto } from '../src/shared/contracts';

function fixture(economy=false){
 const ground=new Container(),layer=new Container(),airLayer=new Container(),complete=vi.fn(),sound=vi.fn();
 const walk=new Map(Array.from({length:144},(_,i)=>({x:i%12,y:Math.floor(i/12)})).map(c=>[`${c.x},${c.y}`,c]));
 const task={id:'one',stage:1,footprint:[{x:4,y:4},{x:5,y:4},{x:4,y:5},{x:5,y:5}],accessPath:[{x:4,y:6}],siteBounds:{minX:4,minY:4,maxX:5,maxY:5}} as ChunkTaskDto;
 const building=new Container(),platform=new Container();building.addChild(new Graphics().rect(-8,-24,16,24).fill(0x81975b));building.position.set(40,48);platform.position.set(32,32);ground.addChild(platform,building);
 const view=createCityCinematicView({layer,airLayer,walk:()=>walk,roads:()=>new Set(),economy:()=>economy,texture:()=>Texture.EMPTY,complete,sound});
 const target=new Container(),targetPlatform=new Container();target.position.set(100,120);targetPlatform.position.set(92,104);ground.addChild(targetPlatform,target);
 return{ground,layer,airLayer,complete,view,task,building,platform,target,targetPlatform,setEconomy:(value:boolean)=>{economy=value;}};
}
it('applies the current task filter to the captured building, crew and hidden destination without changing reveal ownership',()=>{
 const f=fixture();f.view.begin({eventId:1,version:2,taskId:'one',kind:'CONSTRUCT',fromStage:1,toStage:2},{task:f.task,building:f.building,platform:f.platform},0);
 f.view.target('one',{task:f.task,building:f.target,platform:f.targetPlatform,markers:[],version:2});
 f.view.setTaskOpacity(()=>.16);
 expect(f.building.alpha).toBe(.16);expect(f.platform.alpha).toBe(.16);expect(f.layer.children[0]!.alpha).toBe(.16);
 expect(f.target.alpha).toBe(.16);expect(f.target.visible).toBe(false);
 f.view.update(1200);expect(f.building.alpha).toBe(.16);expect(f.target.visible).toBe(false);
 f.view.setTaskOpacity(()=>1);expect(f.building.alpha).toBe(1);expect(f.layer.children[0]!.alpha).toBe(1);
 f.view.clear();expect(f.target.visible).toBe(true);expect(f.target.alpha).toBe(1);expect(f.complete).not.toHaveBeenCalled();
 f.ground.destroy({children:true});f.layer.destroy({children:true});f.airLayer.destroy({children:true});
});
it('conceals authoritative objects until reveal, destroys only its capture and releases every crew object',()=>{
 const f=fixture();expect(f.view.begin({eventId:1,version:2,taskId:'one',kind:'CONSTRUCT',fromStage:1,toStage:2},{task:f.task,building:f.building,platform:f.platform},0)).toBe(true);
 f.view.target('one',{task:{...f.task,stage:2},building:f.target,platform:f.targetPlatform,markers:[],version:2});
 expect(f.target.visible).toBe(false);expect(f.targetPlatform.visible).toBe(false);
 const work=f.view.update(1200);expect(work.workers).toBeGreaterThan(1);expect(f.building.visible).toBe(true);
 f.view.update(2850);expect(f.target.visible).toBe(true);expect(f.building.visible).toBe(false);
 f.view.update(3200);expect(f.complete).toHaveBeenCalledTimes(1);expect(f.building.destroyed).toBe(true);expect(f.platform.destroyed).toBe(true);expect(f.target.destroyed).toBe(false);expect(f.layer.children).toHaveLength(0);expect(f.view.update(3300).ghosts).toBe(0);
 f.ground.destroy({children:true});f.layer.destroy({children:true});f.airLayer.destroy({children:true});
});
it('lifts the original park platform with its building and cancellation restores the real destination',()=>{
 const f=fixture();f.view.begin({eventId:1,version:2,taskId:'one',kind:'TRANSFER',fromStage:5},{task:f.task,building:f.building,platform:f.platform},0);
 f.view.target('one',{task:f.task,building:f.target,platform:f.targetPlatform,markers:[],version:2});
 const flying=f.view.update(3000);expect(flying.states[0]?.aircraftVisible).toBe(true);expect(f.building.parent).toBe(f.airLayer);expect(f.platform.parent).toBe(f.airLayer);expect(f.platform.x-32).toBe(f.building.x-40);expect(f.platform.y-32).toBe(f.building.y-48);expect(f.target.visible).toBe(false);
 f.view.clear();expect(f.target.visible).toBe(true);expect(f.targetPlatform.visible).toBe(true);expect(f.airLayer.children).toHaveLength(0);expect(f.layer.children).toHaveLength(0);expect(f.building.destroyed).toBe(true);expect(f.view.update(4000).ghosts).toBe(0);
 f.ground.destroy({children:true});f.layer.destroy({children:true});f.airLayer.destroy({children:true});
});
it('economy caps concurrent capture ownership and demolition makes the removed building noninteractive',()=>{
 const f=fixture(true);f.building.eventMode='static';f.view.begin({eventId:1,version:2,taskId:'one',kind:'DEMOLISH',fromStage:5},{task:f.task,building:f.building,platform:f.platform},0);
 expect(f.building.eventMode).toBe('none');expect(f.view.begin({eventId:2,version:3,taskId:'two',kind:'CONSTRUCT',fromStage:1,toStage:2},{task:{...f.task,id:'two'},building:f.target,platform:f.targetPlatform},1)).toBe(false);
 const marker=new Container();f.ground.addChild(marker);f.view.target('one',{markers:[marker],version:2});expect(marker.visible).toBe(false);
 f.view.update(3000);expect(marker.visible).toBe(true);expect(f.view.has('one')).toBe(false);expect(f.building.destroyed).toBe(true);
 f.ground.destroy({children:true});f.layer.destroy({children:true});f.airLayer.destroy({children:true});
});

it('trims an active crew on quality downgrade without losing its readiness gate or completing twice',()=>{
 const f=fixture();
 try{
  const request={eventId:1,version:2,taskId:'one',kind:'CONSTRUCT' as const,fromStage:4,toStage:5};
  expect(f.view.begin(request,{task:{...f.task,stage:4},building:f.building,platform:f.platform},0)).toBe(true);
  const target={task:{...f.task,stage:5},building:f.target,platform:f.targetPlatform,markers:[]};
  f.view.target('one',{...target,version:-1});
  const work=f.view.update(1200);expect(work.workers).toBe(6);expect(work.states[0]).toMatchObject({phase:'WORK',fromStage:4,toStage:5});
  const root=f.layer.children[0]!,workers=root.children.slice(0,-2),removed=workers.slice(3),before=f.view.reservedCells();
  const removedStandingCells=removed.map(worker=>`${Math.round(worker.x/8-.5)},${Math.round(worker.y/8-1)}`);
  for(const cell of removedStandingCells)expect(before.has(cell)).toBe(true);
  f.setEconomy(true);const trimmed=f.view.update(1300);
  expect(trimmed.workers).toBe(3);expect(trimmed.ghosts).toBe(1);expect(f.view.has('one')).toBe(true);
  expect(root.destroyed).toBe(false);expect(f.building.destroyed).toBe(false);expect(f.target.visible).toBe(false);
  for(const worker of removed){expect(worker.destroyed).toBe(true);expect(root.children).not.toContain(worker);}
  for(const worker of workers.slice(0,3))expect(worker.destroyed).toBe(false);
  const after=f.view.reservedCells();expect(after.size).toBeLessThan(before.size);
  for(const cell of after)expect(before.has(cell)).toBe(true);
  for(const cell of removedStandingCells)expect(after.has(cell)).toBe(false);
  f.view.update(1400);expect(f.view.reservedCells()).toBe(after);
  const held=f.view.update(3200);expect(held.frames[0]).toMatchObject({startedAtMs:0,phase:'COVER',revealTarget:false,done:false});
  expect(f.target.visible).toBe(false);expect(f.targetPlatform.visible).toBe(false);expect(f.complete).not.toHaveBeenCalled();
  f.view.target('one',{...target,version:2});f.view.update(3300);
  expect(f.complete).toHaveBeenCalledTimes(1);expect(f.complete.mock.calls[0]![0]).toMatchObject({startedAtMs:0,revealTarget:true,done:true});
  expect(f.target.visible).toBe(true);expect(f.targetPlatform.visible).toBe(true);expect(f.building.destroyed).toBe(true);
  expect(f.view.has('one')).toBe(false);expect(f.view.reservedCells().size).toBe(0);expect(f.layer.children).toHaveLength(0);
  f.view.update(3400);expect(f.view.begin(request,{task:f.task,building:f.target,platform:f.targetPlatform},3400)).toBe(false);
  expect(f.complete).toHaveBeenCalledTimes(1);
 }finally{f.view.clear();f.ground.destroy({children:true});f.layer.destroy({children:true});f.airLayer.destroy({children:true});}
});
