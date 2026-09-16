import type { CompiledBlockLayoutV1, TaskPlacementV1, BlockServiceRole } from "../shared/block-world";
import type { CityDevelopmentDto, DevelopmentObjectState } from "../shared/city-development";
import { infrastructureMilestones } from "../shared/city-development-policy";
import { CITY_LANDMARKS } from "../shared/city-landmarks";
import { blockSlots } from "../shared/block-templates";
const state = (placement?: TaskPlacementV1): DevelopmentObjectState => !placement || placement.constructionStage === 1 ? "PLANNED"
  : placement.constructionStage === 5 ? "READY" : placement.constructionStage === 4 ? "TESTING" : "BUILDING";
/** Projection of one canonical layout snapshot; never creates reservations. */
export function cityDevelopment(layout?: CompiledBlockLayoutV1): CityDevelopmentDto {
  if (!layout) return { revision: 0, districts: [], services: [], landmarks: CITY_LANDMARKS.map(item => ({ ...item, state: "UNDISCOVERED" })) };
  const placements = new Map(layout.placements.map(p => [`${p.blockId}:${p.slotKey}`, p]));
  const occupied = new Set(layout.placements.map(p=>p.blockId));
  const markers = new Map(layout.siteMarkers.map(m=>[`${m.blockId}:${m.slotKey}`,m]));
  const nonempty = layout.blocks.filter(b=>occupied.has(b.id));
  const kinds = new Map(layout.blocks.flatMap(b=>blockSlots(b).map(s=>[`${b.id}:${s.key}`,s.kind] as const)));
  return {
    revision: layout.revision,
    districts: layout.districtLayouts.map(d=>{
      const own = new Set(layout.blocks.filter(b=>b.districtLayoutId===d.id).map(b=>b.id));
      return { id: d.districtId, milestones: infrastructureMilestones({ districtId: d.districtId,
        buildings: layout.placements.filter(p=>own.has(p.blockId)&&kinds.get(`${p.blockId}:${p.slotKey}`)==="BUILDING").length,
        districtBlocks: nonempty.filter(b=>own.has(b.id)).length, cityBlocks: nonempty.length,
        cityDistricts: new Set(nonempty.map(b=>b.districtLayoutId)).size,
      }) };
    }),
    services: layout.blocks.flatMap(b=>Object.entries(b.parameters.slotRoles as Record<string, BlockServiceRole> ?? {}).map(([slot,role])=>{
      const key = `${b.id}:${slot}`, placement=placements.get(key), marker=markers.get(key);
      return { districtId: layout.districtLayouts.find(d => d.id === b.districtLayoutId)?.districtId, role, state: marker && !placement ? "HISTORICAL" as const : state(placement),
        taskId: placement?.taskId ?? marker?.targetTaskId,
        trigger: (b.parameters.slotRoleTriggers as Record<string,string> | undefined)?.[slot] };
    })),
    landmarks: CITY_LANDMARKS.map(item=>{
      const placement=layout.placements.find(p=>p.buildingFamily===item.family);
      const marker=layout.siteMarkers.find(m=>m.snapshot.buildingFamily===item.family);
      return { ...item, state: placement ? state(placement) : marker ? "HISTORICAL" : "UNDISCOVERED", taskId: placement?.taskId ?? marker?.targetTaskId };
    }),
  };
}
