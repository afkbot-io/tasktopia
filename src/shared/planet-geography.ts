import type { Cell, Rect } from "./contracts";
import type { PlanetAtlasDto, PlanetCountryDto } from "./planet-atlas-contract";
import { projectPlanetAtlas, projectPlanetWorldPoint, type PlanetPoint, type PlanetTerrainCell } from "./planet-atlas";

/** Private persisted geography. Only explicitly authorized country records may
 * be copied into a response; removed memberships keep their internal reserve. */
export type PersonalPlanetGeography = {
  version: 1;
  width: number;
  height: number;
  hexRadius: number;
  countries: Record<string, {
    continent: number;
    sector?: number;
    cells: PlanetTerrainCell[];
    center: PlanetPoint;
    worldBounds: Rect | null;
    cities: Record<string, { sourceCenter: Cell; point: PlanetPoint }>;
  }>;
  coastCells: PlanetTerrainCell[];
  coastOwners: Record<string, string[]>;
};

export class PlanetGeographyCapacityError extends Error {
  constructor() { super("На текущей обзорной области не осталось места для новой страны"); }
}
const key = (q: number, r: number) => `${q}:${r}`;
const directions = [[1,0],[-1,0],[0,1],[0,-1]] as const;
const hash = (text: string) => {
  let value = 2166136261;
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0;
  return value;
};

/** Imports exactly the previous view once, before any incremental allocation. */
export function importPersonalPlanet(atlas: PlanetAtlasDto): PersonalPlanetGeography {
  const projected = projectPlanetAtlas({ ...atlas, geography: undefined });
  return structuredClone({
    version: 1, width: projected.width, height: projected.height, hexRadius: projected.hexRadius,
    countries: Object.fromEntries(projected.countries.map(country => [country.id, {
      continent: country.continent, cells: country.cells, center: country.center, worldBounds: country.worldBounds,
      cities: Object.fromEntries(country.cities.map(city => [city.id, { sourceCenter: city.center, point: country.cityAnchors[city.id]! }])),
    }])),
    coastCells: projected.coastCells,
    coastOwners: Object.fromEntries(projected.coastCells.map(cell => {
      const distances = projected.countries.map(country => ({id:country.id,distance:Math.min(...country.cells.map(c=>Math.abs(c.q-cell.q)+Math.abs(c.r-cell.r)))}));
      const nearest = Math.min(...distances.map(d=>d.distance));
      return [cell.id,distances.filter(d=>d.distance===nearest).map(d=>d.id)];
    })),
  });
}

function appendCities(record: PersonalPlanetGeography["countries"][string], country: PlanetCountryDto, radius: number) {
  const dry = record.cells.filter(cell => cell.terrain !== "river");
  const pending = [...country.cities].filter(city=>!record.cities[city.id]).sort((a,b)=>a.id.localeCompare(b.id));
  if (!pending.length) return;
  if (!dry.length) throw new PlanetGeographyCapacityError();
  // An empty country had no CITY extent to freeze. Establish it with the first
  // city, before any anchor exists; later growth never changes this extent.
  if(!record.worldBounds && Object.keys(record.cities).length===0 && country.worldBounds)
    record.worldBounds={...country.worldBounds};
  const anchors = Object.values(record.cities).map(anchor=>anchor.point);
  // One old point can exclude at most four centres of a finer square grid.
  // This bounds the search by the actual number of reserved/new cities, not by
  // an arbitrary capacity that can make an otherwise valid atlas stop opening.
  let maximumSubdivision=1;
  while(dry.length*maximumSubdivision*maximumSubdivision<=4*(anchors.length+pending.length))maximumSubdivision*=2;
  const indexes = new Map<number,Map<string,PlanetPoint[]>>();
  const add = (index:Map<string,PlanetPoint[]>,step:number,point:PlanetPoint) => {
    const id=key(Math.floor(point.x/step),Math.floor(point.y/step)),bucket=index.get(id)??[];
    bucket.push(point);index.set(id,bucket);
  };
  let subdivision=1;
  for (const city of pending) {
    const preferred = projectPlanetWorldPoint({ ...country, worldBounds: record.worldBounds }, city.center, record.cells, radius).point;
    const ordered = [...dry].sort((a,b)=>
      Math.hypot((a.q*2+1)*radius-preferred.x,(a.r*2+1)*radius-preferred.y)
      - Math.hypot((b.q*2+1)*radius-preferred.x,(b.r*2+1)*radius-preferred.y) || a.r-b.r || a.q-b.q);
    let chosen:PlanetPoint|undefined;
    for(;subdivision<=maximumSubdivision;subdivision*=2){
      const step=radius*2/subdivision;
      let index=indexes.get(subdivision);
      if(!index){index=new Map();for(const point of anchors)add(index,step,point);indexes.set(subdivision,index);}
      const clear=(point:PlanetPoint)=>{
        const x=Math.floor(point.x/step),y=Math.floor(point.y/step);
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)for(const old of index!.get(key(x+dx,y+dy))??[])
          if((old.x-point.x)**2+(old.y-point.y)**2<step*step-1e-10)return false;
        return true;
      };
      search: for(const cell of ordered)for(let y=0;y<subdivision;y++)for(let x=0;x<subdivision;x++){
        const point={x:cell.q*radius*2+(x+.5)*step,y:cell.r*radius*2+(y+.5)*step};
        if(clear(point)){chosen=point;break search;}
      }
      if(chosen)break;
    }
    if(!chosen)throw new PlanetGeographyCapacityError();
    record.cities[city.id]={sourceCenter:city.center,point:chosen};anchors.push(chosen);
    for(const [density,index] of indexes)add(index,radius*2/density,chosen);
  }
}

/** Pure bounded allocation: existing cells/anchors never move. Throwing leaves
 * the caller's snapshot unchanged, so persistence can be committed atomically. */
export function extendPersonalPlanet(previous: PersonalPlanetGeography, atlas: PlanetAtlasDto): PersonalPlanetGeography {
  const next = structuredClone(previous);
  const radius = next.hexRadius;
  const columns = Math.round(next.width / (radius * 2) - 1.5);
  const rows = Math.round(next.height / (radius * 2) - 1.5);

  for (const country of [...atlas.countries].sort((a,b) => a.id.localeCompare(b.id))) {
    if (next.countries[country.id]) { appendCities(next.countries[country.id]!, country, radius); continue; }
    const source = projectPlanetAtlas({ ...atlas, geography: undefined, countries: [country] }).countries[0]!;
    const minQ = Math.min(...source.cells.map(c => c.q)), minR = Math.min(...source.cells.map(c => c.r));
    const offsets = source.cells.map(cell => ({ ...cell, q:cell.q-minQ, r:cell.r-minR }));
    const width = Math.max(...offsets.map(c=>c.q))+1, height = Math.max(...offsets.map(c=>c.r))+1;
    const candidates: Array<{ q:number;r:number;rank:number }> = [];
    for(let r=3;r<rows-height-3;r++) for(let q=3;q<columns-width-3;q++) {
      // Keep the whole new island inside the round ocean aperture.
      if (offsets.some(c => ((q+c.q-columns/2)/(columns*.46))**2+((r+c.r-rows/2)/(rows*.46))**2 > 1)) continue;
      candidates.push({q,r,rank:hash(`${atlas.planetSeed}:${country.id}:${q}:${r}`)});
    }
    candidates.sort((a,b)=>a.rank-b.rank||a.r-b.r||a.q-b.q);
    let position: {q:number;r:number;rank:number} | undefined;
    let occupied = new Set<string>();
    let sector = 0;
    const lastSector = Math.max(0,...Object.values(next.countries).map(c=>c.sector??0));
    // Try existing areas, then one fresh area with the same immutable frame.
    for (; sector <= lastSector + 1; sector++) {
      occupied = new Set([...Object.values(next.countries).filter(c=>(c.sector??0)===sector).flatMap(c=>c.cells),
        ...next.coastCells.filter(c=>(c.sector??0)===sector)].map(c=>key(c.q,c.r)));
      position = candidates.find(origin => offsets.every(cell => {
        for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)if(occupied.has(key(origin.q+cell.q+dx,origin.r+cell.r+dy)))return false;
        return true;
      }));
      if(position)break;
    }
    if(!position)throw new PlanetGeographyCapacityError();
    const dx=(position.q-minQ)*radius*2, dy=(position.r-minR)*radius*2;
    const cells=offsets.map(cell=>({...cell,q:cell.q+position.q,r:cell.r+position.r,id:`${country.id}:${key(cell.q+position.q,cell.r+position.r)}`}));
    const record: PersonalPlanetGeography["countries"][string]={
      sector, continent:Math.max(-1,...Object.values(next.countries).map(c=>c.continent))+1,
      cells,center:{x:source.center.x+dx,y:source.center.y+dy},worldBounds:country.worldBounds,
      cities:Object.fromEntries(country.cities.map(city=>[city.id,{sourceCenter:city.center,point:{x:source.cityAnchors[city.id]!.x+dx,y:source.cityAnchors[city.id]!.y+dy}}])),
    };
    next.countries[country.id]=record;
    for(const cell of cells)occupied.add(key(cell.q,cell.r));
    for(const cell of cells)for(const [dq,dr] of directions){
      const q=cell.q+dq,r=cell.r+dr,id=key(q,r);
      if(occupied.has(id))continue;
      const coastId = `coast:${sector}:${id}`;
      next.coastCells.push({q,r,id:coastId,terrain:"coast",sector});next.coastOwners[coastId]=[country.id];occupied.add(id);
    }
  }
  return structuredClone(next);
}

/** Public projection deliberately omits inaccessible country/city reserves. */
export type VisiblePlanetGeography = Omit<PersonalPlanetGeography, "coastOwners">;
export function visiblePersonalPlanet(geography: PersonalPlanetGeography, atlas: PlanetAtlasDto): VisiblePlanetGeography {
  const countries = Object.fromEntries(atlas.countries.map(country => {
    const stored = geography.countries[country.id]!;
    return [country.id, { ...stored, cities:Object.fromEntries(country.cities.map(city => [city.id,stored.cities[city.id]!])) }];
  }));
  const allowed = new Set(atlas.countries.map(country=>country.id));
  return { version:geography.version,width:geography.width,height:geography.height,hexRadius:geography.hexRadius,
    countries,coastCells:geography.coastCells.filter(cell=>geography.coastOwners[cell.id]?.every(id=>allowed.has(id))) };
}
