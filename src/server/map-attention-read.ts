import type { Db } from "./db";
import type { MapAttentionPage } from "../shared/map-attention";

/** One statement: membership, revision and page share an MVCC snapshot.
 * No task text or other users' identities leave this personal read model. */
export async function readMapAttention(db: Db, userId: string, countryId: string, cityId: string, after: string | null): Promise<MapAttentionPage | undefined> {
  const row = await db.prepare(`SELECT c.world_version AS revision,
    (SELECT COALESCE(jsonb_agg(page.item ORDER BY page.id), '[]'::jsonb) FROM (
      SELECT t.id, jsonb_build_object('id',t.id,'mine',COALESCE(t.assignee_user_id = ?,false),
        'status',t.status,'dueAt',t.due_at,'hasDefects',EXISTS(SELECT 1 FROM task_defects_v18 d WHERE d.task_id=t.id AND d.status <> 'FIXED')) AS item
      FROM tasks_v3 t WHERE t.city_id = city.id AND (?::text IS NULL OR t.id > ?::text)
      ORDER BY t.id LIMIT 251
    ) page) AS tasks
    FROM countries c JOIN cities_v3 city ON city.country_id=c.id
    WHERE c.id=? AND city.id=? AND EXISTS(SELECT 1 FROM country_members m WHERE m.country_id=c.id AND m.user_id=?)`)
    .get<{ revision: number; tasks: MapAttentionPage["tasks"] }>(userId, after, after, countryId, cityId, userId);
  if (!row) return undefined;
  const tasks = row.tasks.slice(0, 250);
  return { revision: Number(row.revision), tasks, next: row.tasks.length > 250 ? tasks.at(-1)!.id : null };
}
