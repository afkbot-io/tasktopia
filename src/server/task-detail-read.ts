import type { Db, Row } from "./db";

// Keep heavy material columns out of the SELECT itself; to_jsonb(t)-keys would
// still detoast/serialize them before discarding them.
const coreColumns = `t.id,t.task_number,t.city_id,t.district_id,t.title,t.description,t.work_item_type,t.acceptance_criteria,
  t.estimate,t.priority,t.status,t.progress,t.due_at,t.building_type,t.visual_kind,t.visual_asset_key,t.platform_type,
  t.created_at,t.updated_at,t.assignee_role,t.creator_user_id,t.assignee_user_id,t.for_user_id`;

const accounts = `(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',account.id,'email',account.email,'name',account.name)),'[]')
  FROM users account WHERE account.id IN(t.creator_user_id,t.assignee_user_id,t.for_user_id)) AS accounts`;

/** Commands inspect their own fields, never every historical child collection. */
export async function readTaskCoreRow(db: Db, countryId: string, taskId: string): Promise<Row | undefined> {
  return db.prepare(`SELECT ${coreColumns}, ${accounts} FROM tasks_v3 t JOIN cities_v3 city ON city.id=t.city_id
    WHERE city.country_id=? AND t.id=?`).get(countryId, taskId);
}

/** Card metadata stays bounded and obtains counts in the same authorized MVCC read. */
export async function readTaskCardRow(db: Db, countryId: string, taskId: string): Promise<Row | undefined> {
  return db.prepare(`SELECT ${coreColumns},
    ${accounts}, jsonb_build_object(
      'comments',(SELECT COUNT(*) FROM task_comments_v3 v WHERE v.task_id=t.id),
      'events',(SELECT COUNT(*) FROM task_events_v7 v WHERE v.task_id=t.id),
      'documents',(SELECT COUNT(*) FROM task_documents_v1 v WHERE v.task_id=t.id),
      'filledDocuments',(SELECT COUNT(*) FROM task_documents_v1 v WHERE v.task_id=t.id AND btrim(v.content)<>''),
      'attachments',(SELECT COUNT(*) FROM task_attachments_v1 v WHERE v.task_id=t.id),
      'mergeRequests',jsonb_array_length(t.merge_requests_json),
      'checklistTotal',(SELECT COUNT(*) FROM task_checklist_items_v1 v WHERE v.task_id=t.id),
      'checklistDone',(SELECT COUNT(*) FROM task_checklist_items_v1 v WHERE v.task_id=t.id AND v.done),
      'defects',(SELECT COUNT(*) FROM task_defects_v18 v WHERE v.task_id=t.id),
      'activeDefects',(SELECT COUNT(*) FROM task_defects_v18 v WHERE v.task_id=t.id AND v.status<>'FIXED'),
      'dependencies',(SELECT COUNT(*) FROM task_dependencies_v1 v WHERE v.task_id=t.id)
    ) AS counts,
    (SELECT COALESCE(jsonb_agg(metadata ORDER BY metadata.position,metadata.id),'[]') FROM (
      SELECT v.id,v.task_id,v.file_name,v.title,v.is_default,v.position,v.actor,v.updated_at,
        char_length(v.content) AS content_length,btrim(v.content)<>'' AS is_filled
      FROM task_documents_v1 v WHERE v.task_id=t.id ORDER BY v.position,v.id LIMIT 51
    ) metadata) AS document_metadata
    FROM tasks_v3 t JOIN cities_v3 city ON city.id=t.city_id WHERE city.country_id=? AND t.id=?`).get(countryId, taskId);
}

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
    entry != null && ["created_at", "updated_at", "fixed_at", "due_at"].includes(name) ? new Date(String(entry)).toISOString() : entry])));
}
