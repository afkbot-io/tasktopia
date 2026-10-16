import type { Db, Row } from "./db";
import { DomainError } from "./app-service";
import { isExactCursorTimestamp } from "./task-collection-read";
import type { CityAlbumItem, CityAlbumPageDto, CityDevelopmentFacts } from "../shared/city-album";
import { CITY_ALBUM_EVENT_TYPES } from "../shared/city-album";
import type { BlockServiceRole } from "../shared/block-world";

const roles = ["EDUCATION", "MEDICAL", "FIRE", "POLICE", "RAILWAY", "AIRPORT", "CIVIC", "SHOP", "PORT"] as const;
const fields = ["tasks", "buildings", "parks", "completedTasks", "occupiedBlocks", "activeDistricts", "completedDistricts"] as const;
function facts(value: unknown): CityDevelopmentFacts | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (fields.some(field => !Number.isSafeInteger(record[field]) || Number(record[field]) < 0) || !Array.isArray(record.readyServices)) return null;
  const readyServices = record.readyServices.slice(0, roles.length).flatMap(item => {
    if (!item || typeof item !== "object" || !roles.includes(item.role) || !Number.isSafeInteger(item.count) || item.count < 0) return [];
    return [{ role: item.role as BlockServiceRole, count: Number(item.count) }];
  });
  return { tasks: Number(record.tasks), buildings: Number(record.buildings), parks: Number(record.parks), completedTasks: Number(record.completedTasks),
    occupiedBlocks: Number(record.occupiedBlocks), activeDistricts: Number(record.activeDistricts), completedDistricts: Number(record.completedDistricts), readyServices };
}

/** Aggregate current durable facts, without rendering or loading a city scene. */
export async function readCityDevelopmentFacts(db: Db, countryId: string, cityId: string): Promise<CityDevelopmentFacts | undefined> {
  const row = await db.prepare(`SELECT jsonb_build_object(
    'tasks',(SELECT COUNT(*)::int FROM tasks_v3 WHERE city_id=city.id),
    'buildings',(SELECT COUNT(*)::int FROM tasks_v3 WHERE city_id=city.id AND visual_kind='BUILDING'),
    'parks',(SELECT COUNT(*)::int FROM tasks_v3 WHERE city_id=city.id AND visual_kind='PARK'),
    'completedTasks',(SELECT COUNT(*)::int FROM tasks_v3 WHERE city_id=city.id AND status='COMPLETED'),
    'occupiedBlocks',(SELECT COUNT(DISTINCT p.block_id)::int FROM task_placements_v1 p JOIN city_layouts_v1 layout ON layout.id=p.layout_id WHERE layout.city_id=city.id AND layout.status='ACTIVE'),
    'activeDistricts',(SELECT COUNT(*)::int FROM districts_v3 WHERE city_id=city.id AND status='ACTIVE'),
    'completedDistricts',(SELECT COUNT(*)::int FROM districts_v3 WHERE city_id=city.id AND status='COMPLETED'),
    'readyServices',(SELECT COALESCE(jsonb_agg(service ORDER BY service.role),'[]'::jsonb) FROM (
      SELECT service_role AS role,COUNT(*)::int AS count FROM tasks_v3 WHERE city_id=city.id AND status='COMPLETED' AND service_role IS NOT NULL GROUP BY service_role
    ) service)
  ) AS facts FROM cities_v3 city WHERE city.id=? AND city.country_id=?`).get<Row>(cityId, countryId);
  return row ? facts(row.facts) ?? undefined : undefined;
}

const operations = new Set(["city.create.v3", "district.create.v3", "district.activate.v3", "district.complete.v3", "district.delete.v1", "task.create.v3", "task.delete.v1"]);
export function capturesCityMilestone(operation: string, payload: unknown): boolean {
  return operations.has(operation) || operation === "task.status.v3" && Boolean(payload && typeof payload === "object" && "status" in payload && payload.status === "COMPLETED");
}
export async function milestoneCityBefore(db: Db, countryId: string, payload: unknown): Promise<string | undefined> {
  if (!payload || typeof payload !== "object") return undefined;
  const input = payload as Record<string, unknown>;
  if (typeof input.cityId === "string") return input.cityId;
  const table = typeof input.taskId === "string" ? "tasks_v3" : typeof input.districtId === "string" ? "districts_v3" : undefined;
  if (!table) return undefined;
  const row = await db.prepare(`SELECT object.city_id FROM ${table} object JOIN cities_v3 city ON city.id=object.city_id WHERE object.id=? AND city.country_id=?`)
    .get<Row>(input.taskId ?? input.districtId, countryId);
  return row ? String(row.city_id) : undefined;
}

type AlbumCursor = { version: 1; countryId: string; cityId: string; at: string; id: number };
export async function readCityAlbum(db: Db, userId: string, countryId: string, cityId: string,
  options: { cursor?: string; limit?: number } = {}): Promise<CityAlbumPageDto> {
  const limit = options.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new DomainError("INVALID_INPUT", "Размер страницы альбома должен быть от 1 до 50");
  let cursor: AlbumCursor | undefined;
  if (options.cursor) {
    try {
      if (options.cursor.length > 2048) throw new Error("cursor too long");
      cursor = JSON.parse(Buffer.from(options.cursor, "base64url").toString("utf8")) as AlbumCursor;
      if (cursor.version !== 1 || cursor.countryId !== countryId || cursor.cityId !== cityId || !isExactCursorTimestamp(cursor.at)
        || !Number.isSafeInteger(cursor.id) || cursor.id <= 0) throw new Error("cursor context mismatch");
    } catch { throw new DomainError("INVALID_INPUT", "Некорректный cursor альбома"); }
  }
  const result = await db.prepare(`WITH membership AS (SELECT 1 FROM country_members WHERE country_id=? AND user_id=?),
    scope AS (SELECT id FROM cities_v3 WHERE id=? AND country_id=? AND EXISTS(SELECT 1 FROM membership)), page AS (
      SELECT e.id,e.type,e.created_at,e.created_at::text AS cursor_key,
        e.payload_json->'development' AS development,e.payload_json->'building' AS building,
        e.payload_json->>'taskId' AS task_id,e.payload_json->>'districtId' AS district_id,
        task.id AS current_task_id,task.task_number AS current_task_number,LEFT(task.title,160) AS current_title
      FROM events e JOIN scope city ON COALESCE(e.payload_json->>'cityId',e.payload_json#>>'{building,city,id}',e.payload_json#>>'{development,cityId}')=city.id
      LEFT JOIN tasks_v3 task ON task.id=e.payload_json->>'taskId' AND task.city_id=city.id
      WHERE e.country_id=? AND e.type IN (${CITY_ALBUM_EVENT_TYPES.map(type => `'${type}'`).join(',')})
        AND (e.type<>'task.status_changed' OR e.payload_json->>'status'='COMPLETED')
        AND (?::text IS NULL OR e.created_at<?::text::timestamptz OR (e.created_at=?::text::timestamptz AND e.id<?))
      ORDER BY e.created_at DESC,e.id DESC LIMIT ?
    ) SELECT EXISTS(SELECT 1 FROM membership) AS allowed,EXISTS(SELECT 1 FROM scope) AS found,
      (SELECT COALESCE(jsonb_agg(page ORDER BY created_at DESC,id DESC),'[]'::jsonb) FROM page) AS items`)
    .get<{ allowed: boolean; found: boolean; items: Row[] }>(countryId,userId,cityId,countryId,countryId,
      cursor?.at ?? null,cursor?.at ?? null,cursor?.at ?? null,cursor?.id ?? null,limit+1);
  if (!result?.allowed) throw new DomainError("FORBIDDEN", "У вас нет доступа к этой стране");
  if (!result.found) throw new DomainError("NOT_FOUND", "Город не найден");
  const selected = result.items.slice(0, limit);
  const items: CityAlbumItem[] = selected.map(row => {
    const development = row.development as { version?: number; cityId?: string; before?: unknown; after?: unknown } | null;
    const snapshot = row.building as { id?: string; taskNumber?: number; title?: string; country?: { id?: string }; city?: { id?: string } } | null;
    const known = development?.version === 1 && development.cityId === cityId;
    const historical = snapshot?.country?.id === countryId && snapshot.city?.id === cityId && typeof snapshot.id === "string" && typeof snapshot.title === "string" && Number.isSafeInteger(snapshot.taskNumber);
    const task = row.current_task_id ? { id: String(row.current_task_id), taskNumber: Number(row.current_task_number), title: String(row.current_title), exists: true }
      : historical ? { id: snapshot!.id!, taskNumber: snapshot!.taskNumber!, title: snapshot!.title!.slice(0,160), exists: false } : null;
    return { eventId: Number(row.id), type: String(row.type) as CityAlbumItem["type"], at: new Date(String(row.created_at)).toISOString(),
      source: known ? "event-with-development" : "legacy-event", task, districtId: row.district_id ? String(row.district_id) : null,
      before: known ? facts(development.before) : null, after: known ? facts(development.after) : null };
  });
  const last = selected.at(-1);
  return { kind: "city.album-page", version: 1, countryId, cityId, items,
    nextCursor: result.items.length > limit && last ? Buffer.from(JSON.stringify({ version: 1, countryId, cityId, at: String(last.cursor_key), id: Number(last.id) } satisfies AlbumCursor)).toString("base64url") : null };
}
