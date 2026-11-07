import {expect,it} from 'vitest';
import {Graphics} from 'pixi.js';
import {createCityLifeView} from '../src/client/city-life-view';
import type {CityLifeScene} from '../src/client/city-life';
const scene:CityLifeScene={id:'garden',taskId:'park',kind:'GARDEN',context:'GREEN',recipeId:'garden-water',route:[],start:42000,durationMs:75000,
  phase:'ACTIVITY',activityAt:45000,position:{x:2.5,y:3.5},actorIds:['native-person'],arrived:1};

it('places native equipment with its actual resident and never intercepts map input',()=>{
  const view=createCityLifeView();try{
    expect(view.update(scene,45000)).toMatchObject({action:'WATER',step:0});
    expect([view.root.x,view.root.y]).toEqual([20,28]);expect(view.root.eventMode).toBe('none');
    const cue=view.root.children[0] as Graphics;
    expect([cue.x,cue.y]).toEqual([0,0]);expect(cue.eventMode).toBe('none');expect(cue.visible).toBe(true);
    expect(cue.context.instructions.length).toBeGreaterThan(0);
    view.update({...scene,position:{x:4.5,y:6.5}},45016);
    expect([view.root.x,view.root.y]).toEqual([36,52]);
    expect(view.update({...scene,phase:'LEAVING'},45050)).toBeUndefined();expect(cue.visible).toBe(false);
    view.update(undefined,45066);expect(view.root.visible).toBe(false);
  }finally{view.root.destroy({children:true});}
});

it('does not redraw unchanged equipment on a display frame or retain drawing history between actions',()=>{
  const view=createCityLifeView();try{
    view.update(scene,45000);const cue=view.root.children[0] as Graphics,first=cue.context.instructions.length;let updates=0;
    cue.context.on('update',()=>updates++);
    for(let frame=1;frame<9;frame++)view.update(scene,45000+frame*16);
    expect(updates).toBe(0);expect(cue.context.instructions).toHaveLength(first);
    expect(view.update(scene,49000)).toMatchObject({action:'PLANT',step:1});expect(updates).toBeGreaterThan(0);
    expect(cue.context.instructions.length).toBeLessThanOrEqual(20);
    expect(view.update(scene,53000)).toMatchObject({action:'INSPECT',step:2});expect(cue.context.instructions.length).toBeLessThanOrEqual(20);
    view.update(undefined,57000);updates=0;
    for(let frame=0;frame<120;frame++)view.update(undefined,57000+frame*16);
    expect(updates).toBe(0);expect(view.root.children).toHaveLength(1);
  }finally{view.root.destroy({children:true});}
});
