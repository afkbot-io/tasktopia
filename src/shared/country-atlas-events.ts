import type { CountryAtlasDto } from "./country-atlas-contract";
import { meanCountryAtlasProgress } from "./country-atlas-progress";
import type { RealtimeEvent, TaskStatus } from "./contracts";

export type CountryAtlasEventImpact = "NONE" | "TASK_PROGRESS" | "STRUCTURE";

const STRUCTURAL_EVENTS = new Set([
  "country.regenerated",
  "city.created", "city.updated", "city.renamed", "city.deleted",
  "district.created", "district.updated", "district.renamed", "district.deleted", "district.activated", "district.completed",
  "task.created", "task.renamed", "task.deleted",
  "archive.record_created", "archive.record_deleted",
]);

export function countryAtlasEventImpact(event: Pick<RealtimeEvent, "type" | "payload">): CountryAtlasEventImpact {
  if (STRUCTURAL_EVENTS.has(event.type)) return "STRUCTURE";
  if (event.type === "task.fields_updated") {
    const changedFields = Array.isArray(event.payload.changedFields) ? event.payload.changedFields : [];
    return changedFields.some((field) => field === "title" || field === "priority") ? "STRUCTURE" : "NONE";
  }
  if (event.type === "task.status_changed") return event.payload.groundChanged === true ? "STRUCTURE" : "TASK_PROGRESS";
  return "NONE";
}

export function countryAtlasEventBatchImpact(events: ReadonlyArray<Pick<RealtimeEvent, "type" | "payload">>): CountryAtlasEventImpact {
  let impact: CountryAtlasEventImpact = "NONE";
  for (const event of events) {
    const eventImpact = countryAtlasEventImpact(event);
    if (eventImpact === "STRUCTURE") return "STRUCTURE";
    if (eventImpact === "TASK_PROGRESS") impact = "TASK_PROGRESS";
  }
  return impact;
}

export function enqueueCountryAtlasEvent(current: RealtimeEvent[], event: RealtimeEvent): RealtimeEvent[] {
  const impact = countryAtlasEventImpact(event);
  if (impact === "NONE") return current;
  if (impact === "STRUCTURE") return [event];
  const taskId = typeof event.payload.taskId === "string" ? event.payload.taskId : undefined;
  if (!taskId) return [...current, event];
  return [
    ...current.filter((queued) => !(
      countryAtlasEventImpact(queued) === "TASK_PROGRESS"
      && queued.payload.taskId === taskId
    )),
    event,
  ];
}

export function patchCountryAtlasTaskProgress(atlas: CountryAtlasDto, event: RealtimeEvent): CountryAtlasDto {
  if (countryAtlasEventImpact(event) !== "TASK_PROGRESS") return atlas;
  const taskId = typeof event.payload.taskId === "string" ? event.payload.taskId : undefined;
  const progress = typeof event.payload.progress === "number" ? Math.max(0, Math.min(100, Math.round(event.payload.progress))) : undefined;
  const stage = typeof event.payload.stage === "number" ? Math.max(1, Math.min(5, Math.round(event.payload.stage))) : undefined;
  const status = typeof event.payload.status === "string" ? event.payload.status as TaskStatus : undefined;
  if (!taskId || progress === undefined || stage === undefined || !status) return atlas;
  let matched = false;
  const cities = atlas.cities.map((city) => {
    if (!city.buildings.some((building) => building.id === taskId)) return city;
    matched = true;
    const buildings = city.buildings.map((building) => building.id === taskId
      ? { ...building, progress, stage, status }
      : building);
    return {
      ...city,
      buildings,
      districts: city.districts.map((district) => ({
        ...district,
        progress: meanCountryAtlasProgress(buildings.filter((building) => building.districtId === district.id)),
      })),
    };
  });
  return matched ? { ...atlas, worldVersion: event.worldVersion, cities } : atlas;
}
