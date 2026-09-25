import type { Db } from "./db";
import type { CityNews } from "../shared/city-news";
export async function readCityNews(
  db: Db,
  userId: string,
  countryId: string,
  history: boolean,
  before: number | null,
): Promise<CityNews | undefined> {
  const row = await db
    .prepare(
      `WITH scope AS (SELECT 1 FROM country_members WHERE country_id=? AND user_id=?), eligible AS (
    SELECT e.id,e.created_at,t.id AS task_id,t.task_number,t.title,c.name AS city_name,
      CASE WHEN e.type='task.defect_created' THEN 'DEFECT'
        WHEN e.type='task.assignee_changed' OR (e.type='task.status_changed' AND e.payload_json->>'status'='STARTED') THEN 'ASSIGNED'
        WHEN t.service_role IS NOT NULL THEN 'OPENED' ELSE 'COMPLETED' END AS kind
    FROM events e JOIN tasks_v3 t ON t.id=e.payload_json->>'taskId' JOIN cities_v3 c ON c.id=t.city_id
    WHERE EXISTS(SELECT 1 FROM scope) AND e.country_id=? AND c.country_id=e.country_id AND e.created_at>=CURRENT_TIMESTAMP - INTERVAL '30 days'
      AND (e.type='task.defect_created' OR (e.type='task.status_changed' AND e.payload_json->>'status'='COMPLETED')
        OR ((e.type='task.assignee_changed' OR (e.type='task.status_changed' AND e.payload_json->>'status'='STARTED')) AND e.payload_json->>'assigneeUserId'=?))
  ), grouped AS (
    SELECT task_id,task_number,title,city_name,kind,COUNT(*)::int AS count,MAX(id) AS last_id,MAX(created_at) AS at FROM eligible GROUP BY task_id,task_number,title,city_name,kind
  ), cards AS (
    SELECT g.*,g.last_id>COALESCE(r.event_id,0) AS unread FROM grouped g LEFT JOIN notification_reads_v1 r ON r.user_id=? AND r.country_id=? AND r.task_id=g.task_id AND r.kind=g.kind
  ), page AS (SELECT * FROM cards WHERE (?::boolean OR unread) AND (?::bigint IS NULL OR last_id<?) ORDER BY last_id DESC LIMIT 21)
  SELECT EXISTS(SELECT 1 FROM scope) AS allowed,(SELECT COUNT(*)::int FROM cards WHERE unread) AS "unreadCount",
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('taskId',task_id,'taskNumber',task_number,'title',title,'cityName',city_name,'kind',kind,'count',count,'lastEventId',last_id,'at',at,'unread',unread) ORDER BY last_id DESC),'[]'::jsonb) FROM page) AS items`,
    )
    .get<CityNews & { allowed: boolean }>(
      countryId,
      userId,
      countryId,
      userId,
      userId,
      countryId,
      history,
      before,
      before,
    );
  if (!row?.allowed) return undefined;
  const items = row.items.slice(0, 20);
  return {
    items,
    unreadCount: row.unreadCount,
    nextBefore: row.items.length > 20 ? items.at(-1)!.lastEventId : null,
  };
}
export async function readNewsCards(
  db: Db,
  userId: string,
  countryId: string,
  ids: number[],
) {
  // Resolve card identity from authorized events, never from client task/kind labels.
  await db
    .prepare(
      `INSERT INTO notification_reads_v1(user_id,country_id,task_id,kind,event_id)
    SELECT ?,e.country_id,t.id,CASE WHEN e.type='task.defect_created' THEN 'DEFECT'
      WHEN e.type='task.assignee_changed' OR e.payload_json->>'status'='STARTED' THEN 'ASSIGNED'
      WHEN t.service_role IS NOT NULL THEN 'OPENED' ELSE 'COMPLETED' END,MAX(e.id)
    FROM events e JOIN tasks_v3 t ON t.id=e.payload_json->>'taskId' JOIN cities_v3 c ON c.id=t.city_id
    WHERE e.country_id=? AND c.country_id=e.country_id AND e.id=ANY(?::bigint[]) AND EXISTS(SELECT 1 FROM country_members WHERE country_id=e.country_id AND user_id=?)
      AND (e.type='task.defect_created' OR (e.type='task.status_changed' AND e.payload_json->>'status'='COMPLETED') OR ((e.type='task.assignee_changed' OR (e.type='task.status_changed' AND e.payload_json->>'status'='STARTED')) AND e.payload_json->>'assigneeUserId'=?))
    GROUP BY e.country_id,t.id,4
    ON CONFLICT(user_id,country_id,task_id,kind) DO UPDATE SET event_id=GREATEST(notification_reads_v1.event_id,excluded.event_id)`,
    )
    .run(userId, countryId, `{${ids.join(",")}}`, userId, userId);
}
