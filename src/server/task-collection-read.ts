import type { Db, Row } from "./db";
import { DomainError } from "./app-service";
import type { TaskCollection } from "../shared/task-read-contracts";

export type CollectionOrder = "asc" | "desc";
type CollectionCursor = { version: 1; countryId: string; taskId: string; collection: TaskCollection; order: CollectionOrder; key: string | number; id: string };
/** A cursor timestamp must retain PostgreSQL precision and be SQL-valid. */
export function isExactCursorTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 40
    || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::\d{2})?)$/.test(value)
    || !Number.isFinite(Date.parse(value))) return false;
  const calendar = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(calendar.getTime()) && calendar.toISOString().slice(0, 10) === value.slice(0, 10);
}
export const TASK_COLLECTIONS = ["comments","events","defects","attachments","documents","checklist","dependencies","mergeRequests"] as const;
export const defaultCollectionOrder = (collection: TaskCollection): CollectionOrder =>
  ["documents","checklist","dependencies"].includes(collection) ? "asc" : "desc";
export function collectionCursor(countryId: string, taskId: string, collection: TaskCollection, order: CollectionOrder, row: Row): string {
  const key = collection === "dependencies" ? Number(row.task_number)
    : ["documents","checklist"].includes(collection) ? Number(row.position) : String(row.cursor_key ?? row.created_at);
  const id = String(collection === "mergeRequests" ? row.url : row.id);
  return Buffer.from(JSON.stringify({ version: 1, countryId, taskId, collection, order, key, id } satisfies CollectionCursor)).toString("base64url");
}
function decodeCursor(value: string | undefined, countryId: string, taskId: string, collection: TaskCollection, order: CollectionOrder): CollectionCursor | undefined {
  if (!value) return undefined;
  try {
    if (value.length > 8192) throw new Error("cursor too long");
    const cursor = JSON.parse(Buffer.from(value,"base64url").toString("utf8")) as CollectionCursor;
    if (cursor.version!==1 || cursor.countryId!==countryId || cursor.taskId!==taskId || cursor.collection!==collection || cursor.order!==order
      || typeof cursor.id!=="string" || cursor.id.length>2000) throw new Error("cursor context mismatch");
    if (["documents","checklist","dependencies"].includes(collection)) {
      if (!Number.isSafeInteger(cursor.key) || Number(cursor.key)<0 || Number(cursor.key)>2147483647) throw new Error("invalid position");
    } else if (!isExactCursorTimestamp(cursor.key)) throw new Error("invalid timestamp");
    if (collection==="events" && (!/^[1-9]\d{0,18}$/.test(cursor.id) || BigInt(cursor.id)>9223372036854775807n)) throw new Error("invalid event id");
    return cursor;
  } catch { throw new DomainError("INVALID_INPUT","Некорректный cursor коллекции задачи"); }
}

export async function readTaskCollectionRows(db: Db, countryId: string, taskId: string, collection: TaskCollection,
  options: { cursor?: string; limit?: number; order?: CollectionOrder } = {}): Promise<{ rows: Row[]; nextCursor: string | null }> {
  const owner = await db.prepare(`SELECT t.id FROM tasks_v3 t JOIN cities_v3 city ON city.id=t.city_id
    WHERE t.id=? AND city.country_id=?`).get(taskId,countryId);
  if (!owner) throw new DomainError("NOT_FOUND","Задача не найдена");
  const order = options.order ?? defaultCollectionOrder(collection);
  if (!["asc", "desc"].includes(order)) throw new DomainError("INVALID_INPUT", "Некорректный порядок коллекции");
  const cursor = decodeCursor(options.cursor,countryId,taskId,collection,order);
  const limit = options.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new DomainError("INVALID_INPUT", "Размер страницы должен быть от 1 до 100");
  const operator = order === "asc" ? ">" : "<";
  const direction = order.toUpperCase();
  const tables = { comments:"task_comments_v3",events:"task_events_v7",defects:"task_defects_v18",attachments:"task_attachments_v1",
    documents:"task_documents_v1",checklist:"task_checklist_items_v1" } as const;
  let from: string; let selected: string; let where: string; let key: string; let id: string;
  const parameters: unknown[] = [taskId];
  if (collection==="dependencies") {
    from = "task_dependencies_v1 dependency JOIN tasks_v3 v ON v.id=dependency.depends_on_task_id JOIN cities_v3 target_city ON target_city.id=v.city_id";
    selected = "v.id,v.task_number,v.title,v.status"; where = "dependency.task_id=? AND target_city.country_id=?";
    parameters.push(countryId); key="v.task_number"; id="v.id";
  } else if (collection==="mergeRequests") {
    from = `tasks_v3 task CROSS JOIN LATERAL jsonb_to_recordset(task.merge_requests_json) AS v(url text,title text,actor text,"addedAt" timestamptz)`;
    selected = `v.url,v.title,v.actor,v."addedAt" AS created_at`; where="task.id=?"; key='v."addedAt"'; id="v.url";
  } else {
    from=`${tables[collection]} v`; where="v.task_id=?"; id="v.id";
    key=["documents","checklist"].includes(collection) ? "v.position" : "v.created_at";
    selected=collection==="documents"
      ? "v.id,v.task_id,v.file_name,v.title,v.is_default,v.position,v.actor,v.updated_at,char_length(v.content) AS content_length,btrim(v.content)<>'' AS is_filled"
      : "v.*";
  }
  if (cursor) {
    const keyCast=["documents","checklist","dependencies"].includes(collection) ? "integer" : "timestamptz";
    const idCast=collection==="events" ? "bigint" : "text";
    where+=` AND (${key} ${operator} ?::text::${keyCast} OR (${key}=?::text::${keyCast} AND ${id} ${operator} ?::${idCast}))`;
    parameters.push(cursor.key,cursor.key,cursor.id);
  }
  parameters.push(limit+1);
  const fetched = await db.prepare(`SELECT ${selected},${key}::text AS cursor_key FROM ${from} WHERE ${where} ORDER BY ${key} ${direction},${id} ${direction} LIMIT ?`).all<Row>(...parameters);
  const rows = fetched.slice(0,limit);
  return { rows,nextCursor:fetched.length>limit ? collectionCursor(countryId,taskId,collection,order,rows.at(-1)!) : null };
}
