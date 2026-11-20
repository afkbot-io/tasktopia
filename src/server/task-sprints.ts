import { DomainError } from "./app-service";
import type { Db, Row } from "./db";
import type { TaskStatus } from "../shared/contracts";
import type { TaskSprintPageDto } from "../shared/task-sprints";

/** Keyset pages are pinned to one authorized task; task bodies never enter the cursor. */
export async function readTaskSprints(db: Db, countryId: string, taskId: string,
  options: { cursor?: string; limit?: number } = {}): Promise<TaskSprintPageDto> {
  const limit = options.limit ?? 50;
  if (!Number.isInteger(limit) || limit<1 || limit>100) throw new DomainError("INVALID_INPUT","Размер страницы должен быть от 1 до 100");
  let after=0;
  if (options.cursor) {
    try {
      if(options.cursor.length>8192) throw Error();
      const value=JSON.parse(Buffer.from(options.cursor,"base64url").toString("utf8"));
      if(value.version!==1 || value.countryId!==countryId || value.taskId!==taskId
        || !Number.isSafeInteger(value.sequence) || value.sequence<1) throw Error();
      after=value.sequence;
    } catch { throw new DomainError("INVALID_INPUT","Некорректный cursor истории спринтов"); }
  }
  // Metadata and the bounded page share one MVCC snapshot even if another
  // client commits a handoff while this read is in flight.
  const task=await db.prepare(`SELECT t.district_id,t.work_district_id,h.name AS home_name,w.name AS work_name,
    (SELECT COALESCE(jsonb_agg(page ORDER BY page.sequence),'[]'::jsonb) FROM (
      SELECT p.*,d.name AS district_name,d.status AS district_status FROM task_sprint_phases_v1 p
      JOIN districts_v3 d ON d.id=p.district_id WHERE p.task_id=t.id AND p.sequence>? ORDER BY p.sequence LIMIT ?
    ) page) AS phases FROM tasks_v3 t JOIN cities_v3 c ON c.id=t.city_id
    JOIN districts_v3 h ON h.id=t.district_id JOIN districts_v3 w ON w.id=t.work_district_id
    WHERE t.id=? AND c.country_id=?`).get<Row>(after,limit+1,taskId,countryId);
  if(!task)throw new DomainError("NOT_FOUND","Задача не найдена");
  const rows=(typeof task.phases==='string'?JSON.parse(task.phases):task.phases) as Row[];
  const items=rows.slice(0,limit).map(row=>({id:String(row.id),taskId,districtId:String(row.district_id),districtName:String(row.district_name),
    sequence:Number(row.sequence),districtStatus:row.district_status as import("../shared/contracts").DistrictStatus,
    outcome:row.outcome as "OPEN"|"CARRIED"|"COMPLETED",entryStatus:row.entry_status as TaskStatus,
    entryProgress:Number(row.entry_progress),entryEstimate:Number(row.entry_estimate),exitStatus:row.exit_status as TaskStatus|null,
    exitProgress:row.exit_progress==null?null:Number(row.exit_progress),exitEstimate:row.exit_estimate==null?null:Number(row.exit_estimate),
    enteredAt:new Date(String(row.entered_at)).toISOString(),exitedAt:row.exited_at?new Date(String(row.exited_at)).toISOString():null,comment:String(row.comment)}));
  return {kind:"task.sprint-page",version:1,countryId,taskId,homeDistrictId:String(task.district_id),currentDistrictId:String(task.work_district_id),
    homeDistrictName:String(task.home_name),currentDistrictName:String(task.work_name),items,
    nextCursor:rows.length>limit?Buffer.from(JSON.stringify({version:1,countryId,taskId,sequence:items.at(-1)!.sequence})).toString("base64url"):null};
}
