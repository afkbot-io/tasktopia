import {PROP_ATLAS,PROP_CATALOG,PROP_SPRITES,TILE_SPRITES,gameAssetUrl,getBuilding,illuminatedPropKey} from '../shared/catalog';
import type {ChunkDto,ChunkTaskDto} from '../shared/contracts';
import {transportBuildingArt} from '../shared/transport-building-art';
import {greenAreaSurfaceLayout} from '../shared/green-area';
import {taskParkDecorLayout} from '../shared/task-park';
import {publicSpaceRenderStage} from '../shared/public-space-stage';
import {CONSTRUCTION_TILE_KEYS,constructionStageLayout} from '../shared/construction-stage';
import {atlasTerrainKindFromWorld,atlasTerrainTile} from '../shared/atlas-scene';
import {taskPlatformCells,taskPlatformCellPresentation} from './world-building-presentation';
import {incidentVisualProfile} from './task-incidents';
import {microIncidentResponder} from './micro-incident-responder';

type AssetLod='DETAIL'|'OVERVIEW';
type TaskAssets=(task:ChunkTaskDto,lod:AssetLod)=>readonly string[];
// Authored catalog metadata only; no city/task objects live in module scope.
const authoredPropUrls=new Set(Object.entries(PROP_CATALOG).flatMap(([kind,prop])=>PROP_ATLAS.frames[kind]?[prop.path]:[]));

export function taskEntityAssetUrls(task:ChunkTaskDto,lod:AssetLod):readonly string[]{
  const urls=new Set<string>(),entry=transportBuildingArt(task).entry;
  if(lod==='DETAIL'){
    if(task.visualKind==='PARK'){
      for(const{x,y,role}of greenAreaSurfaceLayout(task.footprint,publicSpaceRenderStage(task.stage),task.visualAssetKey)){
        if(role==='WATER'||role==='MEADOW')urls.add(gameAssetUrl(atlasTerrainTile(role==='WATER'?'shallow_water':'meadow','city',x,y,0).url));
      }
      for(const placement of taskParkDecorLayout(task.footprint,publicSpaceRenderStage(task.stage),task.visualAssetKey,task.taskNumber)){
        const metadata=PROP_CATALOG[placement.kind];if(metadata)urls.add(metadata.path);
        const litKey=illuminatedPropKey(placement.kind);
        if(litKey!==placement.kind&&PROP_CATALOG[litKey])urls.add(PROP_CATALOG[litKey]!.path);
      }
    }else{
      if(task.stage<5)for(const key of CONSTRUCTION_TILE_KEYS)urls.add(TILE_SPRITES[key]!);
      if(task.stage<=2){
        const entrance=entry.entrances[0]??{side:'S' as const,offset:Math.floor(entry.footprint.width/2)};
        const construction=constructionStageLayout(entry.footprint,entrance,task.stage,task.taskNumber);
        for(const detail of construction.details)urls.add(PROP_SPRITES[detail.key]!);
      }
      if(task.stage>2)urls.add(entry.stages[task.stage-1]!);
      for(const cell of taskPlatformCells(task.footprint,task.stage)){
        const presentation=taskPlatformCellPresentation(entry);
        if(presentation.family==='terrain')urls.add(gameAssetUrl(atlasTerrainTile(atlasTerrainKindFromWorld(presentation.key),'city',cell.x,cell.y,0).url));
      }
    }
    if(incidentVisualProfile(task).burning)urls.add(microIncidentResponder(entry.spriteSize.width).visual.url);
  }
  return [...urls];
}

/** One renderer owns these pure requirements. Readiness, leases and failures
 * remain with their current owners; a newly patched immutable task is a miss. */
export function createRequiredEntityAssets(computeTaskAssets:TaskAssets=taskEntityAssetUrls){
  const requirements=new WeakMap<ChunkTaskDto,Partial<Record<AssetLod,readonly string[]>>>();
  return(chunks:Iterable<ChunkDto>,lod:AssetLod,extraTasks:Iterable<ChunkTaskDto>=[]):string[]=>{
    const urls=new Set<string>([PROP_SPRITES['active-district-flag']!]);
    const addTaskAssets=(tasks:Iterable<ChunkTaskDto>)=>{
      for(const task of tasks){
        let byLod=requirements.get(task),assets=byLod?.[lod];
        if(assets===undefined){
          assets=computeTaskAssets(task,lod);
          if(!byLod){byLod={};requirements.set(task,byLod);}
          byLod[lod]=assets;
        }
        for(const url of assets)urls.add(url);
      }
    };
    addTaskAssets(extraTasks);
    for(const chunk of chunks){
      addTaskAssets(chunk.tasks);
      for(const feature of lod==='DETAIL'?chunk.worldFeatures:[]){
        if(feature.kind==='RUIN'){
          urls.add(PROP_SPRITES['compact-construction-bricks']!);urls.add(PROP_SPRITES['compact-construction-sand']!);
        }
        if(feature.assetKind==='PROP'){
          const metadata=PROP_CATALOG[feature.assetKey];if(metadata)urls.add(metadata.path);
        }else if(feature.assetKind==='BUILDING')urls.add(getBuilding(feature.assetKey).stages[4]!);
      }
      if(lod!=='DETAIL')continue;
      for(const decoration of chunk.decorations){
        const metadata=PROP_CATALOG[decoration.kind];if(!metadata)continue;
        if(decoration.kind.startsWith('boat-'))urls.add(metadata.path);
      }
    }
    if(lod==='DETAIL'){
      urls.add(PROP_ATLAS.path);
      urls.add(gameAssetUrl(atlasTerrainTile('grass','city',0,0,0).url));
      urls.add(gameAssetUrl(atlasTerrainTile('meadow','city',0,0,0).url));
      urls.add(PROP_SPRITES['traffic-light-red']!);urls.add(PROP_SPRITES['traffic-light-green']!);
    }
    return [...new Set([...urls].map(url=>authoredPropUrls.has(url)?PROP_ATLAS.path:url))];
  };
}
