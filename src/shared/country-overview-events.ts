import type { RealtimeEvent } from "./contracts";

export type CountryOverviewEventImpact = "NONE" | "TASK_PROGRESS" | "STRUCTURE";

const STRUCTURAL_EVENTS = new Set([
  "country.regenerated",
  "city.created", "city.updated", "city.renamed", "city.deleted",
  "district.created", "district.updated", "district.renamed", "district.deleted", "district.activated", "district.completed",
  "task.created", "task.renamed", "task.deleted",
  "archive.record_created", "archive.record_deleted",
]);

export function countryOverviewEventImpact(event: Pick<RealtimeEvent, "type" | "payload">): CountryOverviewEventImpact {
  if (STRUCTURAL_EVENTS.has(event.type)) return "STRUCTURE";
  if (event.type === "task.fields_updated") {
    const changedFields = Array.isArray(event.payload.changedFields) ? event.payload.changedFields : [];
    return changedFields.some((field) => field === "title" || field === "priority") ? "STRUCTURE" : "NONE";
  }
  if (event.type === "task.status_changed") return event.payload.groundChanged === true ? "STRUCTURE" : "TASK_PROGRESS";
  return "NONE";
}

export function countryOverviewEventBatchImpact(
  events: ReadonlyArray<Pick<RealtimeEvent, "type" | "payload">>,
): CountryOverviewEventImpact {
  let impact: CountryOverviewEventImpact = "NONE";
  for (const event of events) {
    const eventImpact = countryOverviewEventImpact(event);
    if (eventImpact === "STRUCTURE") return "STRUCTURE";
    if (eventImpact === "TASK_PROGRESS") impact = "TASK_PROGRESS";
  }
  return impact;
}

export function enqueueCountryOverviewEvent(current: RealtimeEvent[], event: RealtimeEvent): RealtimeEvent[] {
  const impact = countryOverviewEventImpact(event);
  if (impact === "NONE") return current;
  if (impact === "STRUCTURE") return [event];
  const taskId = typeof event.payload.taskId === "string" ? event.payload.taskId : undefined;
  if (!taskId) return [...current, event];
  return [
    ...current.filter((queued) => !(
      countryOverviewEventImpact(queued) === "TASK_PROGRESS"
      && queued.payload.taskId === taskId
    )),
    event,
  ];
}
