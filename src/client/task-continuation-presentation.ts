import type { WorldFeatureDto } from '../shared/contracts';
import type { ConstructionLifeTask } from './construction-life';

/** A single active crew follows the worksite; the home building retains its own geometry. */
export function continuationConstructionContext(
  tasks:readonly (ConstructionLifeTask&{currentDistrictId?:string})[],features:readonly WorldFeatureDto[],
):{tasks:ConstructionLifeTask[];obstacles:WorldFeatureDto[]}{
  const result:ConstructionLifeTask[]=tasks.filter(task=>!task.currentDistrictId);
  const active=new Set<string>();
  for(const feature of features){
    const site=feature.continuation;
    if(!site?.taskId||site.outcome!=='OPEN'||!site.status||!feature.districtId||!feature.footprint.length)continue;
    const bounds=feature.footprint.reduce((b,p)=>({minX:Math.min(b.minX,p.x-1),minY:Math.min(b.minY,p.y-1),
      maxX:Math.max(b.maxX,p.x+1),maxY:Math.max(b.maxY,p.y+1)}),{minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity});
    result.push({id:site.taskId,taskNumber:site.taskNumber,districtId:feature.districtId,footprint:feature.footprint,
      accessPath:feature.accessPath,status:site.status,progress:site.progress??0,siteBounds:bounds});
    active.add(feature.id);
  }
  return {tasks:result,obstacles:features.filter(feature=>!active.has(feature.id))};
}
