import type { BuildingEventContext, RealtimeEvent, TaskStatus } from "./contracts";

export type RealtimeNoticePresentation = {
  id: number;
  title: string;
  location: string;
  tone: "info" | "success";
  actionLabel: string | null;
  target: BuildingEventContext | null;
};

const buildingStage: Record<TaskStatus, string> = {
  PLANNING: "Проектирование",
  STARTED: "Подготовка площадки",
  IN_PROGRESS: "Строительство",
  TESTING: "Приёмка",
  COMPLETED: "Готово",
};
const parkStage: Record<TaskStatus, string> = {
  PLANNING: "Проектирование",
  STARTED: "Подготовка территории",
  IN_PROGRESS: "Благоустройство",
  TESTING: "Приёмка",
  COMPLETED: "Готово",
};

function isCell(value: unknown): value is { x: number; y: number } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return Number.isFinite(candidate.x) && Number.isFinite(candidate.y);
}

function isBounds(value: unknown): value is { minX: number; minY: number; maxX: number; maxY: number } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return [candidate.minX, candidate.minY, candidate.maxX, candidate.maxY].every(Number.isFinite);
}

function buildingContext(value: unknown): BuildingEventContext | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<BuildingEventContext>;
  if (typeof candidate.id !== "string" || typeof candidate.taskNumber !== "number" || typeof candidate.title !== "string"
    || (candidate.visualKind !== "BUILDING" && candidate.visualKind !== "PARK")
    || !["PLANNING", "STARTED", "IN_PROGRESS", "TESTING", "COMPLETED"].includes(candidate.status ?? "")
    || typeof candidate.progress !== "number" || typeof candidate.stage !== "number" || !isCell(candidate.origin)
    || !candidate.country || typeof candidate.country.id !== "string" || typeof candidate.country.name !== "string"
    || !candidate.city || typeof candidate.city.id !== "string" || typeof candidate.city.name !== "string"
    || !isCell(candidate.city.center) || !isBounds(candidate.city.bounds)
    || !candidate.district || typeof candidate.district.id !== "string" || typeof candidate.district.name !== "string") return null;
  return candidate as BuildingEventContext;
}

function subject(context: BuildingEventContext): string {
  return `${context.visualKind === "PARK" ? "Парк" : "Здание"} №${context.taskNumber} «${context.title}»`;
}

function genitiveSubject(context: BuildingEventContext): string {
  return `${context.visualKind === "PARK" ? "парка" : "здания"} №${context.taskNumber} «${context.title}»`;
}

function lowerSubject(context: BuildingEventContext): string {
  return `${context.visualKind === "PARK" ? "парк" : "здание"} №${context.taskNumber} «${context.title}»`;
}

function updatedBuildingDetail(event: RealtimeEvent, context: BuildingEventContext): string {
  const fields = Array.isArray(event.payload.changedFields)
    ? event.payload.changedFields.filter((field): field is string => typeof field === "string")
    : [];
  if (fields.includes("checklist")) return `обновлён чек-лист ${context.visualKind === "PARK" ? "благоустройства" : "строительства"}`;
  if (fields.includes("documents")) return `обновлены документы ${context.visualKind === "PARK" ? "благоустройства" : "строительства"}`;
  if (fields.includes("attachments")) return "обновлены файлы-доказательства";
  if (fields.includes("dependencies")) return "обновлены связанные объекты";
  if (fields.includes("mergeRequests")) return "обновлены ссылки на реализацию";
  if (fields.includes("implementationPlan")) return "обновлён план реализации";
  if (fields.includes("architecture")) return "обновлена архитектура";
  if (fields.includes("designSystem")) return "обновлена дизайн-система";
  if (fields.includes("systemAnalysis")) return "обновлён системный анализ";
  return `обновлены ${context.visualKind === "PARK" ? "параметры благоустройства" : "параметры строительства"}`;
}

function eventTitle(event: RealtimeEvent, context: BuildingEventContext): string | null {
  const named = subject(context);
  switch (event.type) {
    case "task.created":
      return `В районе «${context.district.name}» ${context.visualKind === "PARK" ? "заложен" : "заложено"} ${lowerSubject(context)}`;
    case "task.status_changed": {
      const status = typeof event.payload.status === "string" ? event.payload.status as TaskStatus : context.status;
      const stages = context.visualKind === "PARK" ? parkStage : buildingStage;
      if (!(status in stages)) return null;
      if (status === "COMPLETED") return `${named} ${context.visualKind === "PARK" ? "благоустроен" : "построено"}`;
      return `${named} ${context.visualKind === "PARK" ? "перешёл" : "перешло"} на этап «${stages[status]}»`;
    }
    case "task.renamed":
      return `${context.visualKind === "PARK" ? "Парк" : "Здание"} №${context.taskNumber} теперь называется «${context.title}»`;
    case "task.fields_updated":
      return `У ${genitiveSubject(context)} ${updatedBuildingDetail(event, context)}`;
    case "task.assignee_changed":
      return `У ${genitiveSubject(context)} сменился ответственный`;
    case "task.defect_created":
      return `У ${genitiveSubject(context)} зафиксирована неисправность`;
    case "task.defect_updated":
      return event.payload.status === "FIXED"
        ? `Неисправность ${genitiveSubject(context)} устранена`
        : `Обновлено состояние неисправности ${genitiveSubject(context)}`;
    case "task.deleted":
      return `${named} ${context.visualKind === "PARK" ? "удалён с карты" : "снесено"}`;
    default:
      return null;
  }
}

/** Pure presentation seam shared by live socket delivery and durable replay. */
export function presentRealtimeNotice(event: RealtimeEvent): RealtimeNoticePresentation | null {
  if (event.type === "task.comment_added") return null;
  const context = buildingContext(event.payload.building);
  if (!context) return null;
  const title = eventTitle(event, context);
  if (!title) return null;
  const navigable = event.type !== "task.deleted";
  return {
    id: event.id,
    title,
    location: `${context.country.name} · ${context.city.name} · ${context.district.name}`,
    tone: event.type === "task.status_changed" && context.status === "COMPLETED" ? "success" : "info",
    actionLabel: navigable ? (context.visualKind === "PARK" ? "Открыть парк" : "Открыть здание") : null,
    target: navigable ? context : null,
  };
}
