import { expect,it } from "vitest";
import { Container } from "pixi.js";
import { applyWorldDepthOrder, WorldDepthSorter } from "../src/client/world-depth-sorter";

it("retains static ordering, repairs a moving actor and audits the actual result",()=>{
  const building={y:20,label:"building"},car={y:10,label:"car"};
  const objects=[building,car],sorter=new WorldDepthSorter<typeof building>();
  expect(sorter.sort(objects,()=>"BUILDING")).toEqual({changed:true,errors:0});
  expect(objects).toEqual([car,building]);
  expect(sorter.sort(objects,()=>"BUILDING")).toEqual({changed:false,errors:0});
  car.y=30;
  expect(sorter.sort(objects,()=>"BUILDING",false)).toEqual({changed:true});
  expect(objects).toEqual([building,car]);
  // Moving a registered object between layers can change insertion order
  // without changing its pose or the child count. Repair that case too.
  objects.reverse();
  expect(sorter.sort(objects,()=>"BUILDING")).toEqual({changed:true,errors:0});
  expect(objects).toEqual([building,car]);
});

it("invalidates Pixi's cached painter order only when moving objects cross",()=>{
  const layer=new Container({isRenderGroup:true});
  const building=new Container({label:"building",y:20});
  const actor=new Container({label:"actor",y:10});
  layer.addChild(actor,building);
  const sorter=new WorldDepthSorter<Container>();
  let reorderCount=0;
  const sort=()=>sorter.sort(layer.children,()=>"BUILDING",true,ordered=>{
    reorderCount++;
    applyWorldDepthOrder(layer,ordered);
  });
  sort();
  const renderGroup=layer.renderGroup!;
  renderGroup.structureDidChange=false;
  actor.y=15;
  expect(sort()).toEqual({changed:true,errors:0});
  expect(renderGroup.structureDidChange).toBe(false);
  expect(reorderCount).toBe(0);
  actor.y=25;
  expect(sort()).toEqual({changed:true,errors:0});
  expect(layer.children).toEqual([building,actor]);
  expect(renderGroup.structureDidChange).toBe(true);
  expect(reorderCount).toBe(1);
  renderGroup.structureDidChange=false;
  expect(sort()).toEqual({changed:false,errors:0});
  expect(renderGroup.structureDidChange).toBe(false);
  actor.y=5;
  sort();
  expect(layer.children).toEqual([actor,building]);
  expect(renderGroup.structureDidChange).toBe(true);
  expect(reorderCount).toBe(2);
  const appended=new Container({label:"appended",y:30});
  layer.addChild(appended);
  sort();
  expect(reorderCount).toBe(2);
  expect(layer.sortableChildren).toBe(false);
  // This is Pixi's instruction-collection boundary: automatic ordinal sorting
  // must remain disabled for a newly appended child with default zIndex=0.
  if(layer.sortableChildren)layer.sortChildren();
  expect(layer.children).toEqual([actor,building,appended]);
  renderGroup.structureDidChange=false;
  appended.y=0;
  sort();
  expect(layer.children).toEqual([appended,actor,building]);
  expect(reorderCount).toBe(3);
  expect(renderGroup.structureDidChange).toBe(true);
  expect(layer.sortableChildren).toBe(false);
  layer.destroy({children:true});
});

it("publishes a crossing even when append and removal leave matching historical ordinals",()=>{
  const layer=new Container({isRenderGroup:true});
  const first=new Container({label:"first",y:10});
  const second=new Container({label:"second",y:20});
  layer.addChild(second,first);
  const sorter=new WorldDepthSorter<Container>();
  const sort=()=>sorter.sort(layer.children,()=>"BUILDING",true,ordered=>applyWorldDepthOrder(layer,ordered));
  sort();
  expect(layer.children).toEqual([first,second]);
  const appended=new Container({label:"appended",y:30});
  layer.addChild(appended);
  sort();
  layer.removeChild(first);
  first.destroy();
  sort();
  expect(layer.children).toEqual([second,appended]);
  expect([second.zIndex,appended.zIndex]).toEqual([1,0]);
  layer.renderGroup!.structureDidChange=false;
  appended.y=5;
  sort();
  expect(layer.children).toEqual([appended,second]);
  expect(layer.renderGroup!.structureDidChange).toBe(true);
  expect(layer.sortableChildren).toBe(false);
  layer.destroy({children:true});
});
