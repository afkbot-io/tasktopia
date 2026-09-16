import { countryTransportNetwork } from "./transport-network";
import { transportSchedule } from "./transport-schedule";
import type { Cell } from "./contracts";
export type AtlasTransportStop = { id: string; cityId: string; cell: Cell };
export type AtlasGroundRoute = { id: string; from: AtlasTransportStop; to: AtlasTransportStop; cells: Cell[] };
const key = (cell: Cell) => `${cell.x},${cell.y}`;
const neighbors = (cell: Cell): Cell[] => [{ x: cell.x + 1, y: cell.y }, { x: cell.x, y: cell.y + 1 }, { x: cell.x - 1, y: cell.y }, { x: cell.x, y: cell.y - 1 }];

/** Four-neighbour shortest path; only explicitly supplied cells are traversable. */
export function atlasGridPath(start: Cell, goals: ReadonlySet<string>, allowed: ReadonlySet<string>): Cell[] {
  if (!allowed.has(key(start))) return [];
  const queue = [start], previous = new Map<string, Cell | null>([[key(start), null]]);
  for (let index = 0; index < queue.length; index++) {
    const cell = queue[index]!;
    if (goals.has(key(cell))) {
      const path = [cell]; let parent = previous.get(key(cell));
      while (parent) { path.push(parent); parent = previous.get(key(parent)); }
      return path.reverse();
    }
    for (const next of neighbors(cell)) if (allowed.has(key(next)) && !previous.has(key(next))) {
      previous.set(key(next), cell); queue.push(next);
    }
  }
  return [];
}

/** One deterministic connection per additional served city, never across water. */
export function atlasRailRoutes(stops: readonly AtlasTransportStop[], land: readonly Cell[]): AtlasGroundRoute[] {
  const allowed = new Set(land.map(key)), component = new Map<string,number>();
  let nextComponent=0;
  for(const cell of land){
    if(component.has(key(cell)))continue;
    const queue=[cell];component.set(key(cell),nextComponent);
    for(let i=0;i<queue.length;i++)for(const next of neighbors(queue[i]!)){
      const id=key(next);if(!allowed.has(id)||component.has(id))continue;
      component.set(id,nextComponent);queue.push(next);
    }
    nextComponent++;
  }
  const groups=new Map<number,AtlasTransportStop[]>();
  const primary=new Map<string,AtlasTransportStop>();
  for(const stop of [...stops].sort((a,b)=>a.id.localeCompare(b.id)))if(!primary.has(stop.cityId))primary.set(stop.cityId,stop);
  for(const stop of primary.values()){const id=component.get(key(stop.cell));if(id===undefined)continue;
    const group=groups.get(id)??[];group.push(stop);groups.set(id,group);
  }
  const routes:AtlasGroundRoute[]=[];
  for(const group of groups.values())for(const {from,to} of countryTransportNetwork(group.map(stop=>({...stop,taskId:stop.id})))){
    const cells=atlasGridPath(from.cell,new Set([key(to.cell)]),allowed);
    if(cells.length)routes.push({id:transportSchedule("RAIL",from.id,to.id).id,from,to,cells});
  }
  routes.sort((a,b)=>a.id.localeCompare(b.id));
  return routes;
}

/** Shore-to-shore ambient shipping. Every vertex is water, not a land chord. */
export function atlasShipRoutes(continents: ReadonlyMap<number, readonly Cell[]>, ocean: readonly Cell[]): Cell[][] {
  const water = new Set(ocean.map(key));
  const shores = [...continents].sort((a,b) => a[0]-b[0]).map(([, land]) =>
    [...new Map(land.flatMap(neighbors).filter(cell => water.has(key(cell))).map(cell => [key(cell), cell])).values()]);
  const routes: Cell[][] = [];
  for (let i = 1; i < shores.length; i++) {
    const from = shores[i - 1]!, to = shores[i]!;
    if (!from.length || !to.length) continue;
    const center = to.reduce((sum, cell) => ({ x: sum.x + cell.x / to.length, y: sum.y + cell.y / to.length }), { x: 0, y: 0 });
    const start = [...from].sort((a,b) => (a.x-center.x)**2+(a.y-center.y)**2-((b.x-center.x)**2+(b.y-center.y)**2))[0]!;
    const path = atlasGridPath(start, new Set(to.map(key)), water);
    if (path.length > 1) routes.push(path);
  }
  return routes;
}
