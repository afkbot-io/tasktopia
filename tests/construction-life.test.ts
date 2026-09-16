import { expect,it } from "vitest";
import { constructionBand, planConstructionLife, constructionWorkerPose } from "../src/client/construction-life";
const tasks=Array.from({length:20},(_,i)=>({id:`t${i}`,taskNumber:i,districtId:"d",status:"IN_PROGRESS" as const,progress:27,siteBounds:{minX:i*10-1,maxX:i*10+1,minY:-1,maxY:3},footprint:[{x:i*10,y:0}],accessPath:[{x:i*10,y:1},{x:i*10,y:2},{x:i*10,y:3}]}));
it("uses exact progress bands and status overrides",()=>{
  expect(constructionBand("IN_PROGRESS",26)).toBe("FOUNDATION");expect(constructionBand("IN_PROGRESS",27)).toBe("STRUCTURE");
  expect(constructionBand("IN_PROGRESS",52)).toBe("STRUCTURE");expect(constructionBand("IN_PROGRESS",53)).toBe("FINISHING");
  expect(constructionBand("TESTING",100)).toBe("INSPECTION");expect(constructionBand("COMPLETED",100)).toBeNull();
});
it("bounds workers, skips paused and burning sites and keeps materials off paths",()=>{
  const build=(economy=false,reducedMotion=false)=>planConstructionLife(tasks,new Set(["d"]),new Set(["-1,0"]),new Set(["t0"]),{economy,reducedMotion});
  expect(build().flatMap(s=>s.workers)).toHaveLength(8);expect(build(true).flatMap(s=>s.workers)).toHaveLength(2);expect(build(false,true).flatMap(s=>s.workers)).toHaveLength(0);
  expect(build().some(s=>s.taskId==="t0")).toBe(false);
  const paths=new Set(tasks.flatMap(t=>t.accessPath.map(c=>`${c.x},${c.y}`)));
  expect(build().flatMap(s=>s.materials).every(m=>!paths.has(`${m.cell.x},${m.cell.y}`))).toBe(true);
  expect(planConstructionLife(tasks,new Set(),new Set(),new Set(),{economy:false,reducedMotion:false})).toEqual([]);
});
it("does not bridge a blocked cell and is independent of task ordering",()=>{
  const options={economy:false,reducedMotion:false}, active=new Set(["d"]),blocked=new Set(["0,2"]);
  const first=planConstructionLife(tasks,active,blocked,new Set(),options);
  expect(first[0]!.workers).toEqual([]);
  expect(planConstructionLife([...tasks].reverse(),active,blocked,new Set(),options)).toEqual(first);
});

it("reserves materials only on explicitly owned cells and caps all visible sites",()=>{
  const owned = new Set(tasks.flatMap(t=>[{x:t.footprint[0]!.x-1,y:0},{x:t.footprint[0]!.x+1,y:0}]).map(c=>`${c.x},${c.y}`));
  const plan = planConstructionLife(tasks,new Set(["d"]),new Set(),new Set(),{economy:false,reducedMotion:false,materialCells:owned});
  const material = plan.flatMap(s=>s.materials);
  expect(material).toHaveLength(16);
  expect(material.every(m=>owned.has(`${m.cell.x},${m.cell.y}`))).toBe(true);
  expect(new Set(material.map(m=>`${m.cell.x},${m.cell.y}`)).size).toBe(material.length);
  expect(planConstructionLife(tasks,new Set(["d"]),new Set(),new Set(),{economy:false,reducedMotion:false}).flatMap(s=>s.materials)).toEqual([]);
});
it("walks adjacent cells continuously, pauses to work and preserves phase",()=>{
  const worker={id:"worker",path:[{x:0,y:0},{x:1,y:0},{x:1,y:1}]};
  let previous=constructionWorkerPose(worker,0)!, pauses=0;
  const directions=new Set<string>();
  for(let time=10;time<20000;time+=10){
    const pose=constructionWorkerPose(worker,time)!;
    expect(Math.hypot(pose.x-previous.x,pose.y-previous.y)).toBeLessThanOrEqual(.01);
    expect(pose.x===1 || pose.y===0).toBe(true);
    if(pose.x===previous.x&&pose.y===previous.y)pauses++;
    directions.add(pose.direction); previous=pose;
  }
  expect(pauses).toBeGreaterThan(400);
  expect(directions.size).toBe(4);
  expect(constructionWorkerPose(worker,12345)).toEqual(constructionWorkerPose({...worker},12345));
  expect(constructionWorkerPose({id:"empty",path:[]},0)).toBeNull();
});

it("does not borrow an adjacent material cell from a neighbouring parcel",()=>{
  const task={...tasks[0]!,siteBounds:{minX:0,maxX:0,minY:0,maxY:3}};
  const options={economy:false,reducedMotion:false,materialCells:new Set(["-1,0","1,0","0,-1"])};
  expect(planConstructionLife([task],new Set(["d"]),new Set(),new Set(),options)[0]!.materials).toEqual([]);
  expect(planConstructionLife([{...task,siteBounds:undefined}],new Set(["d"]),new Set(),new Set(),options)[0]!.materials).toEqual([]);
});

it("keeps workers and materials outside world features and their entrances",()=>{
  const task=tasks[0]!,options={economy:false,reducedMotion:false,materialCells:new Set(["0,-1","1,0"])};
  const build=(features:{footprint:{x:number;y:number}[];accessPath:{x:number;y:number}[]}[])=>planConstructionLife([task],new Set(["d"]),new Set(),new Set(),{...options,features})[0]!;
  expect(build([]).workers).toHaveLength(2);expect(build([]).materials.length).toBeGreaterThan(0);
  const blocked=build([{footprint:[{x:0,y:-1},{x:0,y:2}],accessPath:[{x:1,y:0}]}]);
  expect(blocked.workers).toEqual([]);expect(blocked.materials).toEqual([]);
  expect(build([]).workers).toHaveLength(2);
});
