import type {Cell,Rect} from "./contracts";
import {openOceanCells} from "./ocean-connectivity";
import {atlasGridPath} from "./atlas-grid-transport";
export type PortOceanLink={countryId:string;cityId:string;worldSeed:number;localOutlet:Cell;oceanOutlet:Cell};
export type PortSiteInput={countryId:string;cityId:string;worldSeed:number;terminal:Rect;cells:readonly (Cell&{water:boolean})[];occupied:readonly Cell[];link?:PortOceanLink;oceanCells:readonly Cell[];oceanBounds:Rect};
export type PortSitePlan={terminal:Rect;approach:Cell[];pier:Cell[];berth:Cell;waterPath:Cell[];link:PortOceanLink};
export type LocalPortSitePlan = Omit<PortSitePlan, "link">;
const key=(p:Cell)=>`${p.x},${p.y}`;
/** The link is trusted geographic data, never a client assertion. This planner
 * validates its scope/current water connectivity; it does not invent a sea
 * connection from a CITY viewport boundary. No terrain or old parcel is edited. */
export function planPortSite(input:PortSiteInput):PortSitePlan|null{
  const {terminal:t,link}=input;
  if(!link||link.countryId!==input.countryId||link.cityId!==input.cityId||link.worldSeed!==input.worldSeed)return null;
  if(!Object.values(t).every(Number.isSafeInteger)||t.maxX-t.minX!==5||t.maxY-t.minY!==3)return null;
  if(!openOceanCells(input.oceanCells,input.oceanBounds).some(p=>key(p)===key(link.oceanOutlet)))return null;
  const cells=new Map(input.cells.map(p=>[key(p),p])),occupied=new Set(input.occupied.map(key));
  for(let y=t.minY;y<=t.maxY;y++)for(let x=t.minX;x<=t.maxX;x++){
    const id=`${x},${y}`;if(!cells.has(id)||cells.get(id)!.water||occupied.has(id))return null;
  }
  const cx=Math.floor((t.minX+t.maxX)/2),cy=Math.floor((t.minY+t.maxY)/2);
  const directions=[{start:{x:t.maxX+1,y:cy},dx:1,dy:0},{start:{x:cx,y:t.maxY+1},dx:0,dy:1},
    {start:{x:t.minX-1,y:cy},dx:-1,dy:0},{start:{x:cx,y:t.minY-1},dx:0,dy:-1}];
  const water=new Set(input.cells.filter(p=>p.water&&!occupied.has(key(p))).map(key));
  if(!water.has(key(link.localOutlet)))return null;
  for(const {start,dx,dy} of directions){
    const approach:Cell[]=[];
    let shore={...start};
    // Stop at the first water cell; unknown or reserved land is impassable.
    // A long inland corridor must not turn a landlocked city into a port.
    while(approach.length<48){
      const cell=cells.get(key(shore));
      if(!cell||occupied.has(key(shore))||cell.water)break;
      approach.push({...shore});shore={x:shore.x+dx,y:shore.y+dy};
    }
    if(!water.has(key(shore)))continue;
    for(let length=3;length<=8;length++){
    const pier=Array.from({length},(_,i)=>({x:shore.x+i*dx,y:shore.y+i*dy}));
    if(pier.some(p=>!water.has(key(p))))break;
    const pierKeys=new Set(pier.map(key)),allowed=new Set<string>();
    // A three-cell envelope encloses the local vessel at every heading.
    for(const p of input.cells){
      if(!water.has(key(p)))continue;
      let clear=true;
      for(let oy=-1;oy<=1&&clear;oy++)for(let ox=-1;ox<=1;ox++){
        const id=`${p.x+ox},${p.y+oy}`;if(!water.has(id)||pierKeys.has(id)){clear=false;break;}
      }
      if(clear)allowed.add(key(p));
    }
    const end=pier.at(-1)!;
    for(const side of [1,-1]){
      const berth={x:end.x-dy*2*side,y:end.y+dx*2*side};
      const waterPath=atlasGridPath(berth,new Set([key(link.localOutlet)]),allowed);
      if(waterPath.length)return {terminal:{...t},approach,pier,berth,waterPath,link:structuredClone(link)};
    }
  }
  }
  return null;
}
