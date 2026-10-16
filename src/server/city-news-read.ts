import type { Db, Row } from "./db";
import type { CityNews, CityNewsItem, CityNewsKind } from "../shared/city-news";
import { DomainError } from "./app-service";
import { isExactCursorTimestamp } from "./task-collection-read";

export type CityNewsOptions = { limit?: number; cursor?: string; kind?: CityNewsKind };
type NewsCursor = { version: 1; countryId: string; history: boolean; kind: CityNewsKind | null; at: string; id: number };
const cursorFor = (countryId: string, history: boolean, kind: CityNewsKind | undefined, row: Row) =>
  Buffer.from(JSON.stringify({ version: 1, countryId, history, kind: kind ?? null, at: String(row.cursor_key), id: Number(row.lastEventId) } satisfies NewsCursor)).toString("base64url");
function readCursor(value: string | undefined, countryId: string, history: boolean, kind?: CityNewsKind): NewsCursor | undefined {
  if (!value) return undefined;
  try {
    if (value.length > 2048) throw new Error("cursor too long");
    const cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as NewsCursor;
    if (cursor.version !== 1 || cursor.countryId !== countryId || cursor.history !== history || cursor.kind !== (kind ?? null)
      || !Number.isSafeInteger(cursor.id) || cursor.id <= 0 || !isExactCursorTimestamp(cursor.at)) throw new Error("cursor context mismatch");
    return cursor;
  } catch { throw new DomainError("INVALID_INPUT", "Некорректный cursor новостей"); }
}

// Personal material/comment/testing actions include the token owner's own
// actions: an AI uses that identity, and those are the updates people expect.
const eligible = `SELECT e.id,e.created_at,t.id AS task_id,t.task_number,LEFT(t.title,160) AS title,c.id AS city_id,c.name AS city_name,
  CASE WHEN e.type='task.defect_created' THEN 'DEFECT'
    WHEN e.type='task.assignee_changed' OR (e.type='task.status_changed' AND e.payload_json->>'status'='STARTED') THEN 'ASSIGNED'
    WHEN e.type='task.comment_added' THEN 'COMMENT'
    WHEN e.type='task.fields_updated' THEN 'MATERIAL'
    WHEN e.payload_json->>'status'='TESTING' THEN 'TESTING'
    WHEN t.service_role IS NOT NULL THEN 'OPENED' ELSE 'COMPLETED' END AS kind
  FROM events e JOIN tasks_v3 t ON t.id=e.payload_json->>'taskId' JOIN cities_v3 c ON c.id=t.city_id
  JOIN scope s ON s.country_id=e.country_id AND c.country_id=s.country_id
  WHERE e.created_at>=CURRENT_TIMESTAMP - INTERVAL '30 days' AND (
    e.type='task.defect_created' OR (e.type='task.status_changed' AND e.payload_json->>'status'='COMPLETED')
    OR ((e.type='task.assignee_changed' OR (e.type='task.status_changed' AND e.payload_json->>'status'='STARTED')) AND e.payload_json->>'assigneeUserId'=s.user_id)
    OR ((t.creator_user_id=s.user_id OR t.assignee_user_id=s.user_id OR t.for_user_id=s.user_id) AND (
      e.type='task.comment_added' OR (e.type='task.status_changed' AND e.payload_json->>'status'='TESTING')
      OR (e.type='task.fields_updated' AND jsonb_exists_any(COALESCE(e.payload_json->'changedFields','[]'::jsonb),
        ARRAY['documents','attachments','mergeRequests','checklist','systemAnalysis','architecture','designSystem','implementationPlan']))
    ))
  )`;

/** Group before applying the page cursor: a burst never gets split across pages. */
export async function readCityNews(db: Db, userId: string, countryId: string, history: boolean, before: number | null,
  options: CityNewsOptions = {}): Promise<CityNews | undefined> {
  const limit = options.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new DomainError("INVALID_INPUT", "Размер страницы новостей должен быть от 1 до 50");
  const cursor = readCursor(options.cursor, countryId, history, options.kind);
  if (cursor && before !== null) throw new DomainError("INVALID_INPUT", "Используйте только cursor или before");
  const row = await db.prepare(`WITH scope AS (
    SELECT country_id,user_id FROM country_members WHERE country_id=? AND user_id=?
  ), eligible AS (${eligible}), adjacent AS (
    SELECT *,lag(task_id) OVER feed AS previous_task,lag(kind) OVER feed AS previous_kind,lag(created_at) OVER feed AS previous_at
    FROM eligible WINDOW feed AS (ORDER BY created_at DESC,id DESC)
  ), bursts AS (
    SELECT *,SUM(CASE WHEN previous_task=task_id AND previous_kind=kind AND previous_at-created_at<=INTERVAL '5 minutes' THEN 0 ELSE 1 END)
      OVER(ORDER BY created_at DESC,id DESC) AS burst FROM adjacent
  ), grouped AS (
    SELECT task_id,task_number,title,city_id,city_name,kind,burst,COUNT(*)::int AS count,MAX(id) AS last_id,MAX(created_at) AS at
      FROM bursts GROUP BY task_id,task_number,title,city_id,city_name,kind,burst
  ), cards AS (
    SELECT g.*,g.last_id>COALESCE(r.event_id,0) AS unread FROM grouped g
    LEFT JOIN notification_reads_v1 r ON r.user_id=? AND r.country_id=? AND r.task_id=g.task_id AND r.kind=g.kind
    WHERE (?::text IS NULL OR g.kind=?)
  ), page AS (
    SELECT * FROM cards WHERE (?::boolean OR unread) AND (?::bigint IS NULL OR last_id<?)
      AND (?::text IS NULL OR at<?::text::timestamptz OR (at=?::text::timestamptz AND last_id<?))
    ORDER BY at DESC,last_id DESC LIMIT ?
  ) SELECT EXISTS(SELECT 1 FROM scope) AS allowed,(SELECT COUNT(*)::int FROM cards WHERE unread) AS "unreadCount",
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('taskId',task_id,'taskNumber',task_number,'title',title,'cityId',city_id,'cityName',city_name,
      'kind',kind,'count',count,'lastEventId',last_id,'at',at,'cursor_key',at::text,'unread',unread) ORDER BY at DESC,last_id DESC),'[]'::jsonb) FROM page) AS items`)
    .get<CityNews & { allowed: boolean; items: (CityNewsItem & { cursor_key: string })[] }>(countryId,userId,userId,countryId,
      options.kind ?? null,options.kind ?? null,history,before,before,cursor?.at ?? null,cursor?.at ?? null,cursor?.at ?? null,cursor?.id ?? null,limit+1);
  if (!row?.allowed) return undefined;
  const selected = row.items.slice(0, limit);
  const items = selected.map(item => ({ taskId: item.taskId, taskNumber: item.taskNumber, title: item.title, cityId: item.cityId,
    cityName: item.cityName, kind: item.kind, count: item.count, lastEventId: item.lastEventId, at: new Date(item.at).toISOString(), unread: item.unread }));
  return { items, unreadCount: row.unreadCount, nextBefore: row.items.length > limit ? items.at(-1)!.lastEventId : null,
    nextCursor: row.items.length > limit ? cursorFor(countryId, history, options.kind, selected.at(-1)!) : null };
}

export async function readNewsCards(db: Db, userId: string, countryId: string, ids: number[]): Promise<void> {
  if (ids.length > 50 || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new DomainError("INVALID_INPUT", "Некорректные eventIds новостей");
  // Identity and eligibility come from current authorized events, never labels
  // supplied by the client. A read means caught up through this actual event.
  await db.prepare(`WITH scope AS (SELECT country_id,user_id FROM country_members WHERE country_id=? AND user_id=?), eligible AS (${eligible})
    INSERT INTO notification_reads_v1(user_id,country_id,task_id,kind,event_id)
    SELECT ?,?,task_id,kind,MAX(id) FROM eligible WHERE id=ANY(?::bigint[]) GROUP BY task_id,kind
    ON CONFLICT(user_id,country_id,task_id,kind) DO UPDATE SET event_id=GREATEST(notification_reads_v1.event_id,excluded.event_id)`)
    .run(countryId,userId,userId,countryId,`{${ids.join(",")}}`);
}
