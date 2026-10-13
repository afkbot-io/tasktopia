import { expect, it } from 'vitest';
import { createAuthScenePlan } from '../src/client/auth-scene-plan';
import { getBuilding } from '../src/shared/catalog';

it('вход представляет цельный город с разными жилыми и общественными зданиями', () => {
  const scene = createAuthScenePlan();
  expect(new Set(scene.buildings.map(b => b.key)).size).toBeGreaterThanOrEqual(7);
  expect(scene.buildings.some(b => b.key.includes('kindergarten'))).toBe(true);
});

it('каждый вход соединён с улицей, здания не стоят на дорогах, спрайты имеют целочисленные координаты',()=>{
  const scene=createAuthScenePlan();
  for(const b of scene.buildings){
    const family=getBuilding(b.key),e=family.entrances[0]!;
    for(let y=b.y;y<b.y+family.footprint.height;y++)for(let x=b.x;x<b.x+family.footprint.width;x++)expect(scene.surfaces.get(`${x},${y}`),b.key).not.toBe('ROAD');
    const y=e.side==='N'?b.y-1:b.y+family.footprint.height,x=b.x+e.offset;
    const frontier=[`${x},${y}`],visited=new Set(frontier);let street=false;
    while(frontier.length){const key=frontier.pop()!,[px,py]=key.split(',').map(Number) as [number,number];
      if(scene.surfaces.get(key)==='ROAD'){street=true;break;}
      for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const next=`${px+dx!},${py+dy!}`;if(scene.surfaces.has(next)&&!visited.has(next)){visited.add(next);frontier.push(next);}}
    }
    expect(street,b.key).toBe(true);
  }
  for(const s of scene.sprites)expect([s.x,s.y,s.width,s.height].every(Number.isInteger),s.url).toBe(true);
});
