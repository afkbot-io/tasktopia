import { isExactCursorTimestamp } from "./task-collection-read";
import type { Db, Row } from "./db";
import { DomainError } from "./app-service";
import type { TaskPriority, TaskStatus, WorkItemType } from "../shared/contracts";

export type TaskListFilters = {
  q?: string; cityId?: string; districtId?: string; status?: TaskStatus; workItemType?: WorkItemType;
  priority?: TaskPriority; assigneeUserId?: string; cursor?: string; limit?: number;
};
type ListCursor = { version: 1; countryId: string; filters: string; key: string; id: string };
const filterIdentity = (options: TaskListFilters): string => JSON.stringify({ q: options.q?.trim() || null,
  cityId: options.cityId ?? null, districtId: options.districtId ?? null, status: options.status ?? null,
  workItemType: options.workItemType ?? null, priority: options.priority ?? null, assigneeUserId: options.assigneeUserId ?? null });

export async function readTaskListPageRows(db: Db, countryId: string, options: TaskListFilters = {}): Promise<{ rows: Row[]; nextCursor: string | null }> {
  const limit = options.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new DomainError("INVALID_INPUT", "Размер страницы должен быть от 1 до 100");
  const filters = filterIdentity(options);
  let cursor: ListCursor | undefined;
  if (options.cursor) {
    try {
      if (options.cursor.length > 8192) throw new Error("cursor too long");
      cursor = JSON.parse(Buffer.from(options.cursor, "base64url").toString("utf8")) as ListCursor;
      if (cursor.version !== 1 || cursor.countryId !== countryId || cursor.filters !== filters
        || typeof cursor.id !== "string" || !/^[\da-f-]{36}$/i.test(cursor.id)
        || !isExactCursorTimestamp(cursor.key)) throw new Error("cursor context mismatch");
    } catch { throw new DomainError("INVALID_INPUT", "Некорректный cursor списка задач"); }
  }
  const where = ["city.country_id=?"]; const parameters: unknown[] = [countryId];
  for (const [field, column] of [["cityId", "t.city_id"], ["districtId", "t.district_id"], ["status", "t.status"],
    ["workItemType", "t.work_item_type"], ["priority", "t.priority"], ["assigneeUserId", "t.assignee_user_id"]] as const) {
    if (options[field] != null) { where.push(`${column}=?`); parameters.push(options[field]); }
  }
  const q = options.q?.trim();
  if (q) {
    if (/^#?\d{1,10}$/.test(q)) {
      const number = Number(q.replace(/^#/, ""));
      // PostgreSQL task_number is int4. A larger search is an absent number,
      // rather than a parameter conversion failure exposed as HTTP500.
      if (number > 2_147_483_647) return { rows: [], nextCursor: null };
      where.push("t.task_number=?"); parameters.push(number);
    }
    else { where.push("t.title ILIKE ? ESCAPE '\\'"); parameters.push(`%${q.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`); }
  }
  if (cursor) { where.push("(t.updated_at<?::text::timestamptz OR (t.updated_at=?::text::timestamptz AND t.id<?))"); parameters.push(cursor.key, cursor.key, cursor.id); }
  parameters.push(limit + 1);
  const fetched = await db.prepare(`SELECT t.id,t.task_number,t.title,t.work_item_type,t.estimate,t.priority,t.status,t.progress,t.city_id,t.district_id,
    t.updated_at,t.updated_at::text AS cursor_key,city.name AS city_name,city.center_x AS city_center_x,city.center_y AS city_center_y,
    city.bounds_json AS city_bounds_json,district.name AS district_name
    FROM tasks_v3 t JOIN cities_v3 city ON city.id=t.city_id JOIN districts_v3 district ON district.id=t.district_id
    WHERE ${where.join(" AND ")} ORDER BY t.updated_at DESC,t.id DESC LIMIT ?`).all<Row>(...parameters);
  const rows = fetched.slice(0, limit); const last = rows.at(-1);
  const nextCursor = fetched.length > limit && last ? Buffer.from(JSON.stringify({ version: 1, countryId, filters,
    key: String(last.cursor_key), id: String(last.id) } satisfies ListCursor)).toString("base64url") : null;
  return { rows, nextCursor };
}
