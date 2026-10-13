import { gameAssetUrl, getBuilding, PROP_CATALOG, TERRAIN_SPRITES } from '../shared/catalog';
import { microAmbientSprite } from '../shared/micro-ambient';
import { roadAtlasConnectionMask, roadAtlasOverlayTile, roadAtlasSurfaceTile, roadAtlasTile, type RoadAtlasSurface } from '../shared/road-atlas';

export const AUTH_SCENE_SIZE = { width: 384, height: 304 };
export type AuthSceneSprite = { url: string; x: number; y: number; width: number; height: number };
export type AuthSceneTile = { url: string; sourceX: number; sourceY: number; x: number; y: number; alpha?: number };
const cellKey = (x: number, y: number) => `${x},${y}`;
const shore = [[7,2],[34,1],[41,5],[44,12],[42,21],[43,28],[38,36],[27,37],[18,35],[7,37],[2,29],[4,20],[1,12],[3,6]];
function onLand(x: number, y: number) {
  let inside = false;
  for (let i = 0, j = shore.length - 1; i < shore.length; j = i++) {
    const a = shore[i]!, b = shore[j]!;
    if ((a[1]! > y) !== (b[1]! > y) && x < (b[0]! - a[0]!) * (y - a[1]!) / (b[1]! - a[1]!) + a[0]!) inside = !inside;
  }
  return inside;
}

/** Authored preview only: no account data, generation or map API. */
export function createAuthScenePlan() {
  const buildings = [
    { key:'compact-teal-mansard-v1', x:7, y:5, stage:5 },
    { key:'compact-garden-house-v1', x:20, y:5, stage:5 },
    { key:'compact-rose-kindergarten-v1', x:28, y:7, stage:5 },
    { key:'compact-olive-cafe-v1', x:7, y:16, stage:5 },
    { key:'compact-apartment-v1', x:7, y:27, stage:5 },
    { key:'compact-modern-school-v1', x:20, y:28, stage:5 },
    { key:'compact-corner-balcony-v1', x:28, y:27, stage:5 },
  ];
  const surfaces = new Map<string, 'ROAD' | RoadAtlasSurface>();
  const tiles: AuthSceneTile[] = [], sprites: AuthSceneSprite[] = [];
  for (let y = 0; y < 38; y++) for (let x = 0; x < 48; x++) {
    const land = onLand(x + .5, y + .5);
    const beach = land && [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => !onLand(x + dx! + .5, y + dy! + .5));
    const radius = land ? 0 : [1,2,3].find(r=>[[r,0],[-r,0],[0,r],[0,-r],[r,r],[-r,-r],[r,-r],[-r,r]].some(([dx,dy])=>onLand(x+dx!+.5,y+dy!+.5)));
    if (radius === undefined) continue;
    const terrain = land ? beach ? 'SAND' : 'GRASS' : 'DEEP_WATER';
    const textures = TERRAIN_SPRITES[terrain]!;
    const edgeFade = Math.min(1, Math.min(x,y,47-x,37-y)/2);
    tiles.push({ url:gameAssetUrl(textures[(x * 7 + y * 13) % textures.length]!),sourceX:0,sourceY:0,x,y,
      alpha:land?1:(radius===1?1:radius===2?.5:.15)*edgeFade });
    if (land && ((x >= 15 && x <= 17 || x >= 36 && x <= 38) && y >= 5 && y <= 36
      || (y >= 13 && y <= 15 || y >= 23 && y <= 25 || y >= 34 && y <= 36) && x >= 5 && x <= 40)) surfaces.set(cellKey(x,y),'ROAD');
  }
  for (const key of [...surfaces.keys()]) {
    const [x,y] = key.split(',').map(Number) as [number,number];
    for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const k = cellKey(x+dx!,y+dy!);
      if (!surfaces.has(k) && onLand(x+dx!+.5,y+dy!+.5)) surfaces.set(k,'PAVEMENT');
    }
  }
  for (const building of buildings) {
    const family = getBuilding(building.key), entrance = family.entrances[0]!;
    const x = building.x + entrance.offset, direction = entrance.side === 'N' ? -1 : 1;
    let y = entrance.side === 'N' ? building.y - 1 : building.y + family.footprint.height;
    for (let step = 0; step < 10 && !surfaces.has(cellKey(x,y)); step++, y += direction) surfaces.set(cellKey(x,y),'PATH_PAVERS');
    sprites.push({url:family.stages[building.stage-1]!, x:(building.x+family.footprint.width/2)*8-family.anchor.x,
      y:(building.y+family.footprint.height)*8-family.anchor.y,width:family.spriteSize.width,height:family.spriteSize.height});
  }
  // Garden paths and a small square. The outer road loop remains continuous.
  for (let x = 20; x <= 33; x++) for (let y = 17; y <= 22; y++)
    if (x === 20 || x === 33 || y === 17 || y === 22 || x === 27) surfaces.set(cellKey(x,y),'PATH_PAVERS');
  const kindAt = (x: number,y: number) => surfaces.get(cellKey(x,y));
  for (const [key,kind] of surfaces) {
    const [x,y] = key.split(',').map(Number) as [number,number];
    const mask = roadAtlasConnectionMask(kind,x,y,kindAt);
    const tile = kind === 'ROAD' ? roadAtlasTile({x,y,mask,structure:'ROAD',roadClass:'LOCAL'}) : roadAtlasSurfaceTile(kind,x,y,mask);
    tiles.push({...tile,url:gameAssetUrl(tile.url),x,y});
    const horizontal = [14,24,35].includes(y), vertical = [16,37].includes(x);
    if (kind === 'ROAD' && ((horizontal && !vertical && x%2===0) || (vertical && !horizontal && y%2===0)))
      tiles.push({...roadAtlasOverlayTile(horizontal?'MARKING_H':'MARKING_V',x,y),url:gameAssetUrl('atlas/road-v2/overlay.png'),x,y});
  }
  const prop = (key: string,x: number,y: number) => {
    const p = PROP_CATALOG[key]!;
    sprites.push({url:p.path,x:x*8-p.anchor.x,y:y*8-p.anchor.y,width:p.size.width,height:p.size.height});
  };
  for (const [x,y] of [[7,4],[12,3],[20,3],[25,3],[30,4],[34,5],[41,10],[40,20],[40,22],[3,26],[4,18],[20,20],[32,20],[23,20],[30,22]]) prop('tree-oak',x!,y!);
  for (const [x,y] of [[5,6],[34,3],[39,5],[42,14],[40,32],[3,12],[40,34],[19,35]]) prop('tree-pine',x!,y!);
  prop('fountain-large',28,21); prop('bench-horizontal',23,18); prop('bench-horizontal',31,18);
  for (const [x,y] of [[22,22],[31,22],[10,12],[32,12],[40,22],[11,22]]) prop('flower-pink',x!,y!);
  for (const [x,y] of [[14,12],[35,12],[14,22],[35,22],[39,33]]) prop('streetlamp-vintage',x!,y!);
  sprites.sort((a,b) => a.y+a.height-(b.y+b.height));
  const actors = [microAmbientSprite('car','blue','east'),microAmbientSprite('car','taxi','west'),microAmbientSprite('person','teal','east')];
  const assets = [...new Set([...tiles.map(t=>t.url),...sprites.map(s=>s.url),...actors.map(a=>a.url)])];
  return { buildings, surfaces, tiles, sprites, actors, assets };
}
