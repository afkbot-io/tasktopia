import type { Db, Row } from "./db";
import { DomainError } from "./app-service";
import { isExactCursorTimestamp } from "./task-collection-read";
import type { ArchiveRecordDto, CityDto, CountryRole, DistrictDto } from "../shared/contracts";
import type { McpArchiveMetadata, McpCityMetadata, McpCountryMetadata, McpDistrictMetadata, McpMetadataPage } from "../shared/mcp-read-contracts";

export type McpMetadataOptions = { cursor?: string; limit?: number };
type Cursor = { version: 1; context: string; createdAt: string; id: string };
const json = <T>(value: unknown): T => (typeof value === "string" ? JSON.parse(value) : value) as T;
function pagination(options: McpMetadataOptions, context: string) {
  const limit = options.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new DomainError("INVALID_INPUT", "Размер страницы должен быть от 1 до 100");
  let cursor: Cursor | undefined;
  if (options.cursor) {
    try {
      if (options.cursor.length > 8192) throw new Error("cursor too long");
      cursor = JSON.parse(Buffer.from(options.cursor, "base64url").toString("utf8")) as Cursor;
      if (cursor.version !== 1 || cursor.context !== context || !isExactCursorTimestamp(cursor.createdAt)
        || typeof cursor.id !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(cursor.id)) throw new Error("cursor mismatch");
    } catch { throw new DomainError("INVALID_INPUT", "Некорректный cursor метаданных MCP"); }
  }
  return { limit, context, afterTime: cursor?.createdAt ?? null, afterId: cursor?.id ?? null };
}
function page<Kind extends string, Item>(kind: Kind, rows: Row[], options: ReturnType<typeof pagination>, project: (row: Row) => Item,
  countryId?: string): McpMetadataPage<Kind, Item> {
  const selected = rows.slice(0, options.limit), last = selected.at(-1);
  return { kind, version: 1, ...(countryId ? { countryId } : {}), items: selected.map(project),
    nextCursor: rows.length > options.limit && last ? Buffer.from(JSON.stringify({ version: 1, context: options.context,
      createdAt: String(last.cursor_key), id: String(last.id) } satisfies Cursor)).toString("base64url") : null };
}

export async function readMcpCountries(db: Db, userId: string, options: McpMetadataOptions) {
  const p = pagination(options, JSON.stringify({ kind: "countries", userId }));
  const rows = await db.prepare(`SELECT country.id,country.name,country.world_version,country.created_at,country.created_at::text AS cursor_key,
    member.role,(SELECT COUNT(*) FROM country_members all_members WHERE all_members.country_id=country.id) AS member_count
    FROM countries country JOIN country_members member ON member.country_id=country.id AND member.user_id=?
    WHERE (?::text::timestamptz IS NULL OR (country.created_at,country.id)>(?::text::timestamptz,?::text))
    ORDER BY country.created_at,country.id LIMIT ?`).all<Row>(userId,p.afterTime,p.afterTime,p.afterId,p.limit+1);
  return page("country.list-page",rows,p,row => ({ id: String(row.id),name: String(row.name),worldVersion: Number(row.world_version),
    createdAt: String(row.created_at),role: String(row.role) as CountryRole,memberCount: Number(row.member_count) } satisfies McpCountryMetadata));
}

const cityMetadata = (row: Row): McpCityMetadata => ({ id: String(row.id),name: String(row.name),status: String(row.status) as CityDto["status"],
  center: { x: Number(row.center_x),y: Number(row.center_y) },bounds: json(row.bounds_json),styleId: String(row.style_id),
  morphology: String(row.morphology) as CityDto["morphology"],createdAt: String(row.created_at),
  districtCount: Number(row.district_count),taskCount: Number(row.task_count) });

async function cityRows(db: Db, countryId: string, options: ReturnType<typeof pagination>, cityId?: string) {
  return db.prepare(`WITH page AS (
    SELECT city.id,city.name,city.status,city.center_x,city.center_y,city.bounds_json,city.style_id,city.morphology,
      city.created_at,city.created_at::text AS cursor_key FROM cities_v3 city WHERE city.country_id=?
      AND (?::text IS NULL OR city.id=?)
      AND (?::text::timestamptz IS NULL OR (city.created_at,city.id)>(?::text::timestamptz,?::text))
    ORDER BY city.created_at,city.id LIMIT ?
  ), districts AS (SELECT city_id,COUNT(*) AS total FROM districts_v3 WHERE city_id IN(SELECT id FROM page) GROUP BY city_id),
  tasks AS (SELECT city_id,COUNT(*) AS total FROM tasks_v3 WHERE city_id IN(SELECT id FROM page) GROUP BY city_id)
  SELECT page.*,COALESCE(districts.total,0) AS district_count,COALESCE(tasks.total,0) AS task_count FROM page
    LEFT JOIN districts ON districts.city_id=page.id LEFT JOIN tasks ON tasks.city_id=page.id ORDER BY page.created_at,page.id`)
    .all<Row>(countryId,cityId??null,cityId??null,options.afterTime,options.afterTime,options.afterId,options.limit+1);
}
export async function readMcpCities(db: Db, countryId: string, options: McpMetadataOptions) {
  const p = pagination(options,JSON.stringify({ kind: "cities",countryId }));
  return page("city.list-page",await cityRows(db,countryId,p),p,cityMetadata,countryId);
}
export async function readMcpCity(db: Db, countryId: string, cityId: string) {
  const rows = await cityRows(db,countryId,pagination({limit:1},"city-card"),cityId);
  if (!rows[0]) throw new DomainError("NOT_FOUND","Город не найден");
  return { kind: "city.card",version: 1,countryId,city: cityMetadata(rows[0]) };
}
export async function readMcpCountryCounts(db: Db, countryId: string) {
  const row = await db.prepare(`SELECT COUNT(*) AS cities FROM cities_v3 WHERE country_id=?`).get<Row>(countryId);
  return { cities: Number(row?.cities ?? 0) };
}

export async function readMcpDistricts(db: Db, countryId: string, cityId: string | undefined, options: McpMetadataOptions) {
  const p = pagination(options,JSON.stringify({ kind: "districts",countryId,cityId: cityId??null }));
  const rows = await db.prepare(`WITH page AS (
    SELECT district.id,district.city_id,district.name,district.status,district.deadline,district.capacity_sp,district.archetype,district.color,
      district.created_at,district.created_at::text AS cursor_key FROM districts_v3 district JOIN cities_v3 city ON city.id=district.city_id
    WHERE city.country_id=? AND (?::text IS NULL OR district.city_id=?)
      AND (?::text::timestamptz IS NULL OR (district.created_at,district.id)>(?::text::timestamptz,?::text))
    ORDER BY district.created_at,district.id LIMIT ?
  ), workload AS (SELECT district_id,COUNT(*) AS count,COALESCE(SUM(estimate),0) AS planned_sp,
    COALESCE(SUM(estimate) FILTER(WHERE status<>'COMPLETED'),0) AS open_sp FROM tasks_v3
    WHERE district_id IN(SELECT id FROM page) GROUP BY district_id)
  SELECT page.*,COALESCE(workload.count,0) AS task_count,COALESCE(workload.planned_sp,0) AS planned_sp,
    COALESCE(workload.open_sp,0) AS open_sp FROM page LEFT JOIN workload ON workload.district_id=page.id ORDER BY page.created_at,page.id`)
    .all<Row>(countryId,cityId??null,cityId??null,p.afterTime,p.afterTime,p.afterId,p.limit+1);
  return page("district.list-page",rows,p,row => ({ id: String(row.id),cityId: String(row.city_id),name: String(row.name),
    status: String(row.status) as DistrictDto["status"],deadline: row.deadline ? String(row.deadline) : null,
    capacitySp: Number(row.capacity_sp),archetype: String(row.archetype) as DistrictDto["archetype"],color: String(row.color),createdAt: String(row.created_at),
    workload: { districtId: String(row.id),targetSp: Number(row.capacity_sp),plannedSp: Number(row.planned_sp),openSp: Number(row.open_sp),
      taskCount: Number(row.task_count),overTargetBySp: Math.max(0,Number(row.planned_sp)-Number(row.capacity_sp)) } } satisfies McpDistrictMetadata),countryId);
}

export async function readMcpArchiveRecords(db: Db, countryId: string, options: McpMetadataOptions) {
  const p = pagination(options,JSON.stringify({ kind: "archive",countryId }));
  const rows = await db.prepare(`SELECT id,archive_id,country_id,kind,title,source_url,tags_json,created_at,updated_at,
    created_at::text AS cursor_key,char_length(body) AS body_length FROM country_archive_records_v1 WHERE country_id=?
    AND (?::text::timestamptz IS NULL OR (created_at,id)>(?::text::timestamptz,?::text)) ORDER BY created_at,id LIMIT ?`)
    .all<Row>(countryId,p.afterTime,p.afterTime,p.afterId,p.limit+1);
  return page("archive.record-page",rows,p,row => ({ id: String(row.id),archiveId: String(row.archive_id),countryId: String(row.country_id),
    kind: String(row.kind) as ArchiveRecordDto["kind"],title: String(row.title),sourceUrl: row.source_url ? String(row.source_url) : null,
    tags: json<string[]>(row.tags_json),createdAt: String(row.created_at),updatedAt: String(row.updated_at),bodyLength: Number(row.body_length) } satisfies McpArchiveMetadata),countryId);
}
