import {expect,it} from "vitest";
import type {Cell,CellRunDto,ChunkTaskDto} from "../src/shared/contracts";
import type {CitySceneDto} from "../src/shared/city-scene-contract";
import {createDistrictDevelopmentGeometry,type DistrictDevelopmentState,type DistrictDevelopmentPlan} from "../src/client/district-development";
import {compactCellRuns} from "../src/shared/world-cell-runs";
import {drawDevelopmentEmphasis,drawDevelopmentOutline} from "../src/client/district-development-view";
const key=(cell:Cell)=>`${cell.x},${cell.y}`;
// Frozen compatibility oracle from the pre-optimization algorithm. It must not
// share the new compact index or boundary implementation.
function legacyPlan(cells: readonly Cell[], blocked: ReadonlySet<string>, state: DistrictDevelopmentState): DistrictDevelopmentPlan {
  const result: DistrictDevelopmentPlan = { fences: [], marker: null };
  if (!cells.length || state === "HIDDEN" || state === "FINISHED") return result;
  const owned = new Set(cells.map(key));
  const used = new Set<string>();
  const boundary = cells.filter(c => [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => !owned.has(key({ x: c.x + dx!, y: c.y + dy! }))));
  boundary.sort((a, b) => a.y - b.y || a.x - b.x);
  const canPlace = (footprint: Cell[]) => footprint.every(c => owned.has(key(c)) && !blocked.has(key(c)) && !used.has(key(c)));
  const reserve = (footprint: Cell[]) => footprint.forEach(c => used.add(key(c)));
  const inward = (cell: Cell) => {
    const directions = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
    return directions.filter(([dx, dy]) => !owned.has(key({ x: cell.x + dx, y: cell.y + dy })))
      .flatMap(([dx, dy]) => [0, 1, 2].map(inset => ({ x: cell.x - dx * inset, y: cell.y - dy * inset })));
  };
  for (const cell of boundary.flatMap(inward)) {
    // Full 16×16 envelope, including the space above the pole.
    const footprint = [cell, { x: cell.x + 1, y: cell.y }, { x: cell.x, y: cell.y + 1 }, { x: cell.x + 1, y: cell.y + 1 }];
    if (!canPlace(footprint)) continue;
    result.marker = { kind: "marker", origin: cell, cells: footprint };
    reserve(footprint);
    break;
  }
  if (state !== "BUILDING" && state !== "PREPARING") return result;
  // Sample the perimeter evenly; avoid thousands of sprites in a large city.
  const stride = Math.max(1, Math.ceil(boundary.length / 96));
  for (let i = 0; i < boundary.length && result.fences.length < 48; i += stride) {
    const c = boundary[i]!;
    const horizontal = !owned.has(key({ x: c.x, y: c.y - 1 })) || !owned.has(key({ x: c.x, y: c.y + 1 }));
    for (const origin of inward(c)) {
      const next = { x: origin.x + (horizontal ? 1 : 0), y: origin.y + (horizontal ? 0 : 1) };
      const footprint = [origin, next];
      if (!canPlace(footprint)) continue;
      result.fences.push({ kind: horizontal ? "fence-horizontal" : "fence-vertical", origin, cells: footprint });
      reserve(footprint);
      break;
    }
  }
  return result;
}


const sceneFor=(pieces:CellRunDto[][],blocked:Cell[]=[]):CitySceneDto=>({chunks:pieces.map((cellRuns,index)=>({
  tasks:[],roadRuns:index?[]:compactCellRuns(blocked),surfaceRuns:[],decorationContext:{blockedCellRuns:[]},
  districts:[{id:"d",status:"ACTIVE",cellRuns}],
})),completedDistrictSnapshots:[]} as unknown as CitySceneDto);

it("keeps canonical ownership and the complete outline compact for long source runs",()=>{
  let endpoints=0;
  const runs=[0,1].map(y=>({start:{x:-2048,y},end:{get x(){endpoints++;return 2047;},y}}));
  const geometry=createDistrictDevelopmentGeometry(sceneFor([runs]));
  expect(geometry.plan("d","PLANNED").marker?.origin).toEqual({x:-2048,y:0});
  expect(endpoints).toBeLessThan(64);
  expect(geometry.outline("d")).toHaveLength(4);
  expect(geometry.intersects("d",{minX:100,minY:0,maxX:101,maxY:1})).toBe(true);
  expect(geometry.intersects("d",{minX:3000,minY:0,maxX:3001,maxY:1})).toBe(false);
});

it("preserves exact canonical plans across negative seams, holes, shuffled pages and every state",()=>{
  for(let seed=0;seed<12;seed++){
    const cells:Cell[]=[];
    for(let y=-12;y<=12;y++)for(let x=-14;x<=14;x++)
      if(!(x>-3&&x<3&&y>-4&&y<4)&&(x*17+y*11+seed*7)%23!==0)cells.push({x,y});
    const blocked=cells.filter(cell=>(cell.x*7+cell.y*3+seed)%9===0);
    const left=cells.filter(cell=>cell.x<0),right=cells.filter(cell=>cell.x>=0);
    const scene=sceneFor([compactCellRuns(right),compactCellRuns(left),compactCellRuns(left.slice(0,8))],blocked);
    const geometry=createDistrictDevelopmentGeometry(scene),owned=new Set(cells.map(key)),blockedKeys=new Set(blocked.map(key));
    for(const state of ["PREPARING","BUILDING","TESTING","PLANNED","FINISHED","HIDDEN"] as const)
      expect(geometry.plan("d",state)).toEqual(legacyPlan(cells,blockedKeys,state));
    const actualEdges=new Set<string>();
    for(const edge of geometry.outline("d")){
      const dx=Math.sign(edge.to.x-edge.from.x),dy=Math.sign(edge.to.y-edge.from.y);
      for(let x=edge.from.x,y=edge.from.y;x!==edge.to.x||y!==edge.to.y;x+=dx,y+=dy)
        actualEdges.add(`${x},${y}:${x+dx},${y+dy}`);
    }
    const expectedEdges=new Set<string>();
    for(const c of cells){
      if(!owned.has(key({x:c.x,y:c.y-1})))expectedEdges.add(`${c.x},${c.y}:${c.x+1},${c.y}`);
      if(!owned.has(key({x:c.x+1,y:c.y})))expectedEdges.add(`${c.x+1},${c.y}:${c.x+1},${c.y+1}`);
      if(!owned.has(key({x:c.x,y:c.y+1})))expectedEdges.add(`${c.x},${c.y+1}:${c.x+1},${c.y+1}`);
      if(!owned.has(key({x:c.x-1,y:c.y})))expectedEdges.add(`${c.x},${c.y}:${c.x},${c.y+1}`);
    }
    expect(actualEdges).toEqual(expectedEdges);
    expect(geometry.districts.get("d")!.cells).toEqual([...cells].sort((a,b)=>a.y-b.y||a.x-b.x));
    const previous=drawDevelopmentEmphasis(cells,8),compact=drawDevelopmentOutline(geometry.outline("d"),8);
    expect(compact.getLocalBounds()).toEqual(previous.getLocalBounds());
    expect(compact.label).toBe(previous.label);expect(compact.eventMode).toBe(previous.eventMode);
    compact.destroy();previous.destroy();
  }
});

it("keeps task footprints and paths blocked even when compact context masks omit them",()=>{
 const scene=sceneFor([compactCellRuns(Array.from({length:64},(_,i)=>({x:i%8,y:Math.floor(i/8)})))]);
 const task={id:"t",footprint:[{x:0,y:0},{x:1,y:0}],accessPath:[{x:0,y:1},{x:1,y:1}]} as ChunkTaskDto;
 scene.chunks[0]!.tasks=[task];
 const geometry=createDistrictDevelopmentGeometry(scene),blocked=new Set([...task.footprint,...task.accessPath].map(key));
 expect(geometry.plan("d","BUILDING")).toEqual(legacyPlan(geometry.districts.get("d")!.cells,blocked,"BUILDING"));
});
