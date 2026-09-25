import type { Db } from "./db";
import type { CityReport } from "../shared/city-report";
export async function readCityReport(
  db: Db,
  userId: string,
  countryId: string,
  cityId: string | null,
  districtId: string | null,
  attention: boolean,
  offset: number,
  days: number,
): Promise<CityReport | undefined> {
  const result = await db
    .prepare(
      `WITH scope AS (
    SELECT 1 FROM country_members WHERE country_id=? AND user_id=?
  ), tasks AS MATERIALIZED (
    SELECT t.*, c.name AS city_name, d.name AS district_name, u.name AS assignee,
      (SELECT COUNT(*)::int FROM task_defects_v18 f WHERE f.task_id=t.id AND f.status<>'FIXED') AS defects,
      (SELECT COUNT(*)::int FROM task_dependencies_v1 x JOIN tasks_v3 p ON p.id=x.depends_on_task_id WHERE x.task_id=t.id AND p.status<>'COMPLETED') AS dependencies
    FROM tasks_v3 t JOIN cities_v3 c ON c.id=t.city_id JOIN districts_v3 d ON d.id=t.district_id LEFT JOIN users u ON u.id=t.assignee_user_id
    WHERE EXISTS(SELECT 1 FROM scope) AND c.country_id=? AND (?::text IS NULL OR c.id=?) AND (?::text IS NULL OR d.id=?)
  ), classified AS (
    SELECT *, (status<>'COMPLETED' AND (due_at<CURRENT_TIMESTAMP OR (assignee IS NULL AND status<>'PLANNING') OR defects>0 OR dependencies>0 OR status='TESTING')) AS attention,
      CASE status WHEN 'PLANNING' THEN 1 WHEN 'COMPLETED' THEN 2 ELSE 0 END AS sort_group FROM tasks
  ), filtered AS (SELECT * FROM classified WHERE NOT ?::boolean OR attention), page AS (
    SELECT * FROM filtered ORDER BY sort_group,task_number,id LIMIT 50 OFFSET ?
  ) SELECT
    (SELECT COUNT(*)::int FROM filtered) AS total,
    jsonb_build_object('working',COUNT(*) FILTER(WHERE status IN ('STARTED','IN_PROGRESS','TESTING')),
      'planned',COUNT(*) FILTER(WHERE status='PLANNING'),'completed',COUNT(*) FILTER(WHERE status='COMPLETED'),
      'testing',COUNT(*) FILTER(WHERE status='TESTING'),'attention',COUNT(*) FILTER(WHERE attention),
      'completedPeriod',COUNT(*) FILTER(WHERE status='COMPLETED' AND EXISTS(SELECT 1 FROM events e WHERE e.country_id=? AND e.type='task.status_changed' AND e.payload_json->>'taskId'=classified.id AND e.payload_json->>'status'='COMPLETED' AND e.created_at>=CURRENT_TIMESTAMP - (?::int * INTERVAL '1 day')))) AS counts,
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'taskNumber',task_number,'title',title,'status',status,'progress',progress,'cityName',city_name,'districtName',district_name,'assignee',assignee,'dueAt',due_at,'defects',defects,'dependencies',dependencies) ORDER BY sort_group,task_number,id),'[]'::jsonb) FROM page) AS items,
    EXISTS(SELECT 1 FROM scope) AS allowed FROM classified`,
    )
    .get<CityReport & { allowed: boolean }>(
      countryId,
      userId,
      countryId,
      cityId,
      cityId,
      districtId,
      districtId,
      attention,
      offset,
      countryId,
      days,
    );
  if (!result?.allowed) return undefined;
  return {
    items: result.items,
    counts: result.counts,
    total: result.total,
    nextOffset:
      offset + result.items.length < result.total
        ? offset + result.items.length
        : null,
  };
}
