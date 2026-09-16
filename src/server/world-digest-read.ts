import type { Db } from "./db";
import type { WorldDigest } from "../shared/world-digest";
/** Membership, upper cursor and current task ownership use one SQL snapshot.
 * Only 1001 relevant events are inspected; at most 20 grouped cards leave SQL.
 * Old payload titles/identities never leave this read model. */
export async function readWorldDigest(db: Db, userId: string, countryId: string, after: number | null): Promise<WorldDigest | undefined> {
  const row = await db.prepare(`WITH scope AS (
    SELECT c.id, COALESCE((SELECT MAX(id) FROM events WHERE country_id=c.id),0) AS cursor
    FROM countries c WHERE c.id=? AND EXISTS(SELECT 1 FROM country_members m WHERE m.country_id=c.id AND m.user_id=?)
  ), recent AS MATERIALIZED (
    SELECT e.id, e.type, e.payload_json, e.created_at FROM events e JOIN scope s ON s.id=e.country_id
    WHERE ?::bigint IS NOT NULL AND e.id > ?::bigint AND e.id <= s.cursor
      AND (e.type='task.defect_created' OR (e.type='task.status_changed' AND e.payload_json->>'status'='COMPLETED'))
    ORDER BY e.id DESC LIMIT 1001
  ), eligible AS (
    SELECT e.id, t.id AS task_id, t.task_number, LEFT(t.title,160) AS title, city.name AS city_name,
      CASE WHEN e.type='task.defect_created' THEN 'DEFECT' WHEN t.service_role IS NOT NULL THEN 'OPENED' ELSE 'COMPLETED' END AS kind
    FROM (SELECT * FROM recent ORDER BY id DESC LIMIT 1000) e
    JOIN tasks_v3 t ON t.id=e.payload_json->>'taskId'
    JOIN cities_v3 city ON city.id=t.city_id JOIN scope s ON s.id=city.country_id
    WHERE e.created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
  ), grouped AS (
    SELECT task_id,task_number,title,city_name,kind,COUNT(*)::int AS count,MAX(id) AS last_id
    FROM eligible GROUP BY task_id,task_number,title,city_name,kind
  ) SELECT s.cursor, (?::bigint IS NULL OR ?::bigint > s.cursor) AS baseline,
    (SELECT COUNT(*)>1000 FROM recent) AS truncated,
    (SELECT COUNT(*)::int FROM eligible WHERE kind='COMPLETED') AS completed,
    (SELECT COUNT(*)::int FROM eligible WHERE kind='DEFECT') AS defects,
    (SELECT COUNT(*)::int FROM eligible WHERE kind='OPENED') AS opened,
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('taskId',g.task_id,'taskNumber',g.task_number,'title',g.title,
      'cityName',g.city_name,'kind',g.kind,'count',g.count,'lastEventId',g.last_id) ORDER BY g.last_id DESC),'[]'::jsonb)
      FROM (SELECT * FROM grouped ORDER BY last_id DESC LIMIT 20) g) AS items FROM scope s`)
    .get<{ cursor: number; baseline: boolean; truncated: boolean; completed: number; defects: number; opened: number; items: WorldDigest["items"] }>(countryId,userId,after,after,after,after);
  if (!row) return undefined;
  return { cursor: Number(row.cursor), baseline: row.baseline, periodDays: 30, truncated: row.truncated,
    totals: { COMPLETED: row.completed, DEFECT: row.defects, OPENED: row.opened }, items: row.items };
}
