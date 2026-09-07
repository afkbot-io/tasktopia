import type { Db, Row } from "./db";

/** One authorized MVCC snapshot; child collections cannot multiply each other. */
export async function readTaskDetailRow(db: Db, countryId: string, taskId: string): Promise<Row | undefined> {
  return db.prepare(`SELECT t.*,
    (SELECT COALESCE(jsonb_agg(v ORDER BY v.created_at),'[]') FROM task_comments_v3 v WHERE v.task_id=t.id) AS comments,
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',v.id,'task_number',v.task_number,'title',v.title,'status',v.status)),'[]')
      FROM task_dependencies_v1 dependency JOIN tasks_v3 v ON v.id=dependency.depends_on_task_id WHERE dependency.task_id=t.id) AS dependencies,
    (SELECT COALESCE(jsonb_agg(v ORDER BY v.id),'[]') FROM task_events_v7 v WHERE v.task_id=t.id) AS events,
    (SELECT COALESCE(jsonb_agg(v ORDER BY v.created_at,v.id),'[]') FROM task_defects_v18 v WHERE v.task_id=t.id) AS defects,
    (SELECT COALESCE(jsonb_agg(v ORDER BY v.created_at,v.id),'[]') FROM task_attachments_v1 v WHERE v.task_id=t.id) AS attachments,
    (SELECT COALESCE(jsonb_agg(v ORDER BY v.position,v.file_name),'[]') FROM task_documents_v1 v WHERE v.task_id=t.id) AS documents,
    (SELECT COALESCE(jsonb_agg(v ORDER BY v.position,v.id),'[]') FROM task_checklist_items_v1 v WHERE v.task_id=t.id) AS checklist,
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',v.id,'email',v.email,'name',v.name)),'[]') FROM users v
      WHERE v.id IN(t.creator_user_id,t.assignee_user_id,t.for_user_id)) AS accounts
    FROM tasks_v3 t JOIN cities_v3 c ON c.id=t.city_id WHERE c.country_id=? AND t.id=?`).get(countryId, taskId);
}

/** JSON aggregation bypasses the driver's timestamptz decoder. Keep DTO dates unchanged. */
export function taskDetailRows(row: Row, key: string): Row[] {
  const values = row[key] as Row[];
  return values.map(value => Object.fromEntries(Object.entries(value).map(([name, entry]) => [name,
    entry != null && ["created_at", "updated_at", "fixed_at"].includes(name) ? new Date(String(entry)).toISOString() : entry])));
}
