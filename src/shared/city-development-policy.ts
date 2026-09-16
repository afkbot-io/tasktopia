import type { BlockServiceRole } from "./block-world";
export const PORT_MIN_CITY_BLOCKS = 6;
export type InfrastructureCounts = { districtId: string; buildings: number; districtBlocks: number; cityBlocks: number; cityDistricts: number };
export type InfrastructureMilestone = { id: string; role: BlockServiceRole; count: number; required: number; unit: "BUILDINGS" | "DISTRICT_BLOCKS" | "CITY_BLOCKS" | "CITY_DISTRICTS"; eligible: boolean };
export const INFRASTRUCTURE_LABELS: Record<BlockServiceRole, string> = { EDUCATION: "Школа", MEDICAL: "Медицинский центр", FIRE: "Пожарная часть", POLICE: "Полиция", RAILWAY: "Вокзал", AIRPORT: "Аэропорт", CIVIC: "Администрация", SHOP: "Магазин", PORT: "Морской порт" };
/** Same priority and trigger IDs as the allocator. Counts exclude empty blocks
 * and public-space tasks; meeting a threshold still needs an available parcel. */
export function infrastructureMilestones(input: InfrastructureCounts): InfrastructureMilestone[] {
  const result: InfrastructureMilestone[] = [];
  const add = (id: string, role: BlockServiceRole, count: number, required: number, unit: InfrastructureMilestone["unit"]) => result.push({ id, role, count, required, unit, eligible: count >= required });
  for (const [ordinal, role] of [[9,"EDUCATION"],[12,"MEDICAL"],[16,"FIRE"],[20,"POLICE"]] as const)
    add(`district:${input.districtId}:${role}:${ordinal}`,role,input.buildings,ordinal-1,"BUILDINGS");
  add("city:RAILWAY:6","RAILWAY",input.cityBlocks,6,"CITY_BLOCKS");
  add("city:AIRPORT:3","AIRPORT",input.cityDistricts,3,"CITY_DISTRICTS");
  add("city:PORT:6","PORT",input.cityBlocks,PORT_MIN_CITY_BLOCKS,"CITY_BLOCKS");
  add("city:CIVIC:18","CIVIC",input.cityBlocks,18,"CITY_BLOCKS");
  for (let n=2;n<=input.districtBlocks+2;n+=2) add(`district:${input.districtId}:SHOP:${n}`,"SHOP",input.districtBlocks,n,"DISTRICT_BLOCKS");
  return result;
}
export function nextInfrastructure(input: InfrastructureCounts, used: ReadonlySet<string>): InfrastructureMilestone | undefined {
  return infrastructureMilestones(input).find(item => item.role !== "PORT" && item.eligible && !used.has(item.id));
}
