import type { Cell, ChunkTaskDto } from '../shared/contracts';
import type { CityMobility, CityMobilityAgent } from './city-mobility';
import type { MapInvalidation } from './map-invalidation';

export type TaskActivityKind = 'COMMENT' | 'UPDATE';
export type TaskActivityTask = Pick<ChunkTaskDto, 'id' | 'stage' | 'accessPath'>;
export type TaskActivityOptions = { enabled: boolean; reducedMotion: boolean; economy: boolean };
export type TaskActivityPose = { taskId: string; eventId: number; kind: TaskActivityKind; anchor: Cell;
  phase: 'DELIVER' | 'DISCUSS' | 'SIGNAL'; visitors: readonly CityMobilityAgent[]; arrived: number;
  startedAt: number; expiresAt: number; static: boolean };

type Delivery = { taskId: string; eventId: number; kind: TaskActivityKind; anchor: Cell;
  visitId: string; startedAt: number; expiresAt: number; static: boolean; arrived: number; arrivedAt?: number };
const key = (cell: Cell) => `${cell.x},${cell.y}`;
// Free-flow estimate only: reserve 8s of the existing 32s delivery for waiting and arrival cues.
const DELIVERY_TRAVEL_BUDGET_MS = 24_000;

/** Ephemeral presentation only. Routes and physical actors stay owned by mobility. */
export function createTaskActivityController(mobility: () => CityMobility | undefined) {
  const active = new Map<string, Delivery>();
  const metrics = { started: 0, merged: 0, delivered: 0 };
  let cursor = 0;
  const cancel = (taskId: string) => {
    const delivery = active.get(taskId);
    if (delivery) mobility()?.clearVisits(delivery.visitId);
    active.delete(taskId);
  };
  const clear = () => { for (const id of active.keys()) cancel(id); };
  return {
    begin(event: MapInvalidation, task: TaskActivityTask | undefined, now: number, options: TaskActivityOptions): boolean {
      if (!Number.isFinite(event.id) || event.id <= cursor) return false;
      cursor = event.id;
      const kind = event.type === 'task.comment_added' ? 'COMMENT'
        : ['task.fields_updated', 'task.assignee_changed', 'task.renamed'].includes(event.type)
          || event.type === 'task.status_changed' && event.stage === task?.stage ? 'UPDATE' : undefined;
      const age = event.createdAt ? now - Date.parse(event.createdAt) : 0;
      const anchor = task?.accessPath[0];
      if (!options.enabled || !kind || !task || task.id !== event.taskId || !anchor || !Number.isFinite(now)
        || !Number.isFinite(age) || age > 15_000 || age < -5000) return false;
      const previous = active.get(task.id);
      if (previous && now < previous.expiresAt && key(previous.anchor) === key(anchor) && previous.static === options.reducedMotion) {
        previous.eventId = event.id; previous.kind = kind;
        metrics.merged++; return true;
      }
      cancel(task.id);
      while (active.size >= (options.economy ? 2 : 4)) cancel(active.keys().next().value!);
      const city = mobility(), visitId = `task-activity:${task.id}:${event.id}`;
      const target = task.accessPath.find(cell => city?.visitTargets.has(key(cell)));
      const adults = city?.agents.filter(a => a.kind === 'WALKER' && a.age !== 'CHILD').map(a => a.id);
      const actors = !options.reducedMotion && target
        ? city?.dispatchVisit(visitId, [target], kind === 'COMMENT' && !options.economy ? 2 : 1, 5000, false, adults, DELIVERY_TRAVEL_BUDGET_MS) ?? [] : [];
      active.set(task.id, { taskId: task.id, eventId: event.id, kind, anchor: { ...anchor }, visitId,
        startedAt: now, expiresAt: now + (options.reducedMotion ? 4000 : actors.length ? 32_000 : 6000),
        static: options.reducedMotion, arrived: 0 });
      metrics.started++; return true;
    },
    update(now: number, tasks: ReadonlyMap<string, TaskActivityTask>, options: TaskActivityOptions): TaskActivityPose[] {
      if (!options.enabled) { clear(); return []; }
      while (active.size > (options.economy ? 2 : 4)) cancel(active.keys().next().value!);
      const agents = mobility()?.agents ?? [], poses: TaskActivityPose[] = [];
      for (const [id, delivery] of active) {
        const entrance = tasks.get(id)?.accessPath[0];
        if (now >= delivery.expiresAt || !entrance || key(entrance) !== key(delivery.anchor)) { cancel(id); continue; }
        if (options.reducedMotion && !delivery.static) {
          mobility()?.clearVisits(delivery.visitId); delivery.static = true; delivery.expiresAt = Math.min(delivery.expiresAt, now + 4000);
        }
        const visitors = agents.filter(a => a.visit?.id === delivery.visitId);
        const arrived = visitors.filter(a => a.visit?.arrived).length;
        if (arrived && delivery.arrivedAt === undefined) {
          delivery.arrivedAt = now; delivery.expiresAt = Math.min(delivery.expiresAt, now + 6500); metrics.delivered++;
        }
        delivery.arrived = Math.max(delivery.arrived, arrived);
        poses.push({ taskId: id, eventId: delivery.eventId, kind: delivery.kind, anchor: delivery.anchor,
          startedAt: delivery.startedAt, expiresAt: delivery.expiresAt, static: delivery.static,
          phase: delivery.arrived ? 'DISCUSS' : visitors.length ? 'DELIVER' : 'SIGNAL', visitors, arrived: delivery.arrived });
      }
      return poses;
    },
    cancel, clear, metrics,
    get activeCount() { return active.size; },
  };
}
