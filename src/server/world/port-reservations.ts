import type { Db } from "../db";
import type { Cell, Rect } from "../../shared/contracts";
import type { PortSitePlan } from "../../shared/port-site";
export type LocalPortPlan = Omit<PortSitePlan, "link">;

/** Compact horizontal runs cover the walkway, pier and the full vessel hull.
 * Persisted plans survive deleted tasks as part of their historical block. */
export function portReservationRects(plans: readonly LocalPortPlan[]): Rect[] {
  const rows = new Map<number, Set<number>>();
  const add = (p: Cell) => { const row = rows.get(p.y) ?? new Set<number>(); row.add(p.x); rows.set(p.y, row); };
  for (const plan of plans) {
    for (const p of [...plan.approach, ...plan.pier]) add(p);
    for (const p of [plan.berth, ...plan.waterPath]) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) add({ x: p.x + dx, y: p.y + dy });
  }
  const result: Rect[] = [];
  for (const [y, row] of [...rows].sort((a, b) => a[0] - b[0])) {
    let run: Rect | undefined;
    for (const x of [...row].sort((a, b) => a - b)) {
      if (run && x === run.maxX + 1) run.maxX = x;
      else { run = { minX: x, maxX: x, minY: y, maxY: y }; result.push(run); }
    }
  }
  return result;
}
export async function countryPortReservations(db: Db, countryId: string): Promise<Rect[]> {
  const rows = await db.prepare(`SELECT b.parameters_json->'slotPortPlans' AS plans
    FROM city_blocks_v1 b JOIN city_layouts_v1 l ON l.id=b.layout_id
    WHERE l.country_id=? AND l.status='ACTIVE' AND jsonb_exists(b.parameters_json, 'slotPortPlans')`)
    .all<{ plans: Record<string, LocalPortPlan> }>(countryId);
  return portReservationRects(rows.flatMap(row => Object.values(row.plans)));
}
