import {describe,expect,it,vi} from 'vitest';
import {createRequiredEntityAssets,taskEntityAssetUrls} from '../src/client/city-entity-assets';
import {getBuilding,PROP_ATLAS,PROP_SPRITES,TILE_SPRITES,gameAssetUrl} from '../src/shared/catalog';
import {CONSTRUCTION_TILE_KEYS} from '../src/shared/construction-stage';
import {atlasTerrainTile} from '../src/shared/atlas-scene';
import {microIncidentResponder} from '../src/client/micro-incident-responder';
import {patchChunkTaskStatuses} from '../src/client/chunk-task-patches';
import type {ChunkDto,ChunkTaskDto} from '../src/shared/contracts';

function task(overrides:Partial<ChunkTaskDto>={}):ChunkTaskDto{
  const entry=getBuilding('compact-wide-v1');
  return {id:'task',taskNumber:17,cityId:'city',districtId:'district',title:'Задача',workItemType:'TASK',status:'IN_PROGRESS',progress:40,
    stage:3,buildingType:entry.key,visualKind:'BUILDING',visualAssetKey:entry.key,platformType:'YARD',origin:{x:3,y:4},
    footprint:Array.from({length:entry.footprint.width*entry.footprint.height},(_,i)=>({x:3+i%entry.footprint.width,y:4+Math.floor(i/entry.footprint.width)})),
    accessPath:[],...overrides};
}
const chunk=(tasks:ChunkTaskDto[]):ChunkDto=>({chunkX:0,chunkY:0,size:32,worldVersion:1,terrain:[],roads:[],surfaces:[],districts:[],tasks,decorations:[],worldFeatures:[]});

describe('renderer-owned entity asset requirements',()=>{
  it('computes each immutable task once per LOD across chunk seams, prefetch, checks and retries',()=>{
    const compute=vi.fn(taskEntityAssetUrls),read=createRequiredEntityAssets(compute),t=task(),a=chunk([t]),b={...chunk([t]),chunkX:1};
    const expected=read([], 'DETAIL',[t]);
    expect(read([a,b],'DETAIL',[t])).toEqual(expected);
    expect(read([a,b],'DETAIL')).toEqual(expected);
    expect(compute).toHaveBeenCalledTimes(1);
    const sorted=read([a],'DETAIL');sorted.sort().pop();
    expect(read([a],'DETAIL')).toEqual(expected);
    expect(read([a,b],'OVERVIEW')).toEqual([PROP_ATLAS.path]);
    read([a],'OVERVIEW');expect(compute).toHaveBeenCalledTimes(2);
    createRequiredEntityAssets(compute)([a],'DETAIL');
    expect(compute).toHaveBeenCalledTimes(3);
  });
  it('invalidates real realtime patches and independent task snapshots without retaining a previous stage or fire',()=>{
    const compute=vi.fn(taskEntityAssetUrls),read=createRequiredEntityAssets(compute),original=chunk([task()]);
    const before=read([original],'DETAIL');
    const patched=patchChunkTaskStatuses(original,new Map([['task',{status:'COMPLETED',progress:100,stage:5,worldVersion:2}]]));
    expect(patched.tasks[0]).not.toBe(original.tasks[0]);
    const after=read([patched],'DETAIL');
    expect(after).toContain(getBuilding('compact-wide-v1').stages[4]);
    expect(after).not.toContain(getBuilding('compact-wide-v1').stages[2]);
    expect(before).toContain(getBuilding('compact-wide-v1').stages[2]);
    expect(compute).toHaveBeenCalledTimes(2);
    read([chunk([{...patched.tasks[0]!}])],'DETAIL');expect(compute).toHaveBeenCalledTimes(3);
    const burning=task({workItemType:'HOTFIX',status:'IN_PROGRESS'});
    expect(read([chunk([burning])],'DETAIL')).toContain(microIncidentResponder(getBuilding(burning.buildingType).spriteSize.width).visual.url);
    expect(read([chunk([{...burning,status:'COMPLETED'}])],'DETAIL')).not.toContain(microIncidentResponder(getBuilding(burning.buildingType).spriteSize.width).visual.url);
  });
  it('preserves authored sheets, construction, complete building art, ruin and animated decoration assets',()=>{
    const t=task(),entry=getBuilding(t.buildingType),read=createRequiredEntityAssets(),c=chunk([t]);
    c.worldFeatures=[{id:'ruin',kind:'RUIN',assetKind:'BUILDING',assetKey:'compact-wide-v1'} as ChunkDto['worldFeatures'][number]];
    const boat=Object.keys(PROP_SPRITES).find(k=>k.startsWith('boat-'))!;
    c.decorations=[{id:'boat',kind:boat,origin:{x:0,y:0}} as ChunkDto['decorations'][number]];
    const urls=read([c],'DETAIL');
    expect(urls).toEqual(expect.arrayContaining([PROP_ATLAS.path,entry.stages[2],entry.stages[4],PROP_ATLAS.frames[boat]?PROP_ATLAS.path:PROP_SPRITES[boat],
      gameAssetUrl(atlasTerrainTile('grass','city',0,0,0).url),gameAssetUrl(atlasTerrainTile('meadow','city',0,0,0).url),
      ...CONSTRUCTION_TILE_KEYS.map(k=>TILE_SPRITES[k])]));
    expect(new Set(urls).size).toBe(urls.length);
    c.worldFeatures=[{id:'replacement',kind:'RUIN',assetKind:'BUILDING',assetKey:'compact-apartment-v1'} as ChunkDto['worldFeatures'][number]];
    expect(read([c],'DETAIL')).toContain(getBuilding('compact-apartment-v1').stages[4]);
    expect(read([c],'DETAIL')).not.toContain(entry.stages[4]);
    expect(read([c],'OVERVIEW')).toEqual([PROP_ATLAS.path]);
  });
  it('keeps both night/day park lights and the fitted transport fallback across completed snapshot requirements',()=>{
    const park=task({visualKind:'PARK',visualAssetKey:'urban-central',stage:5,
      footprint:Array.from({length:144},(_,i)=>({x:i%12,y:Math.floor(i/12)}))});
    expect(taskEntityAssetUrls(park,'DETAIL')).toEqual(expect.arrayContaining([PROP_SPRITES['park-lamp'],PROP_SPRITES['park-lamp-lit']]));
    const airport=task({serviceRole:'AIRPORT',footprint:Array.from({length:18},(_,i)=>({x:3+i%6,y:4+Math.floor(i/6)}))}),read=createRequiredEntityAssets();
    const urls=read([],'DETAIL',[park,airport]);
    expect(urls).toContain(getBuilding('compact-airport-row-v1').stages[2]);
    expect(urls).toContain(PROP_ATLAS.path);
    expect(read([],'DETAIL',[{...airport,stage:5}])).toContain(getBuilding('compact-airport-row-v1').stages[4]);
    expect(read([],'DETAIL',[airport])).toEqual(read([chunk([airport])],'DETAIL'));
    expect(read([],'DETAIL',[{...airport,footprint:[]}])).toContain(getBuilding('compact-wide-v1').stages[2]);
  });
  it('does not cache a failed calculation, so the current retry owner can try the same immutable task again',()=>{
    const t=task(),compute=vi.fn(taskEntityAssetUrls).mockImplementationOnce(()=>{throw new Error('calculation failed');}),read=createRequiredEntityAssets(compute);
    expect(()=>read([chunk([t])],'DETAIL')).toThrow('calculation failed');
    expect(read([chunk([t])],'DETAIL')).toContain(getBuilding(t.buildingType).stages[2]);
    read([chunk([t])],'DETAIL');expect(compute).toHaveBeenCalledTimes(2);
  });
});
