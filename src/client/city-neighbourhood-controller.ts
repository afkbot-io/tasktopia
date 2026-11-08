import type { Cell, Rect } from '../shared/contracts';
import type { CityMobility } from './city-mobility';
import { cityLifePlanFitsSite, type CityLifePlan, type CityLifeScene } from './city-life';
import { CITY_RECIPE_WORK_MS } from './city-event-recipes';
import { CityEventDirector, type CityEventLease } from './city-event-director';

const key = (cell: Cell) => `${cell.x},${cell.y}`;
const distance = (a: Cell, b: Cell) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const ARRIVAL_TIMEOUT_MS = 24_000;
// Cosmetic appointments leave eight seconds for real crossings and queues.
const ARRIVAL_ROUTE_BUDGET_MS = 16_000;
type Running = { plan: CityLifePlan; city: CityMobility; actorIds: string[]; serviceId?: string;
  confirmed: boolean; phase: CityLifeScene['phase']; activityAt?: number; leavingAt?: number; departureOrigins?: ReadonlyMap<string, Cell> };

/** Only owns appointments. The native resolver owns every body, route,
 * passage and arrival; wall time can expire a scene, never complete a trip. */
export function createNeighbourhoodController(mobility: () => CityMobility | undefined, director: CityEventDirector) {
  let active: Running | undefined;
  const rejectedUntil = new Map<string, number>();
  const metrics = { started: 0, activities: 0, completed: 0, cancelled: 0, rejected: 0 };
  const finish = (complete = false) => {
    const previous = active;if (!previous) return;
    active = undefined;
    previous.city.clearVisits(previous.plan.id);previous.city.clearVisits(`${previous.plan.id}:leave`);
    if (previous.serviceId) previous.city.clearResponses(['FIRE'], previous.serviceId, previous.plan.id);
    director.release(previous.plan.id, complete ? 'COMPLETE' : 'CANCEL');
    if (!previous.confirmed) {
      metrics.rejected++;
      if (rejectedUntil.size >= 128) rejectedUntil.delete(rejectedUntil.keys().next().value!);
      rejectedUntil.set(previous.plan.taskId, previous.plan.start + 4000);
    }
    else if (complete) metrics.completed++;else metrics.cancelled++;
  };
  const lease = (plan: CityLifePlan): CityEventLease => ({ id: plan.id, channel: 'NEIGHBOURHOOD', priority: 1,
    cells: [...plan.route, ...(plan.kind === 'DRILL' ? plan.responseCells ?? [] : [])], actors: [],
    until: plan.start + plan.durationMs, replayUntil: Math.max(plan.start + plan.durationMs, (Math.floor(plan.start / 180_000) + 1) * 180_000),
    provisional: true, onRelease: () => { if (active?.plan.id === plan.id) finish(); } });
  const snapshot = (): CityLifeScene | undefined => {
    if (!active) return;
    const { plan, city, phase, actorIds, serviceId } = active, people = city.agents.filter(actor => actorIds.includes(actor.id));
    const lead = people.find(actor => actor.visit?.id === plan.id && actor.visit.arrived) ?? people[0];
    if (!lead) return;
    return { ...plan, phase, actorIds: [...actorIds], serviceId, arrived: people.filter(actor => actor.visit?.id === plan.id && actor.visit.arrived).length,
      position: { ...lead.position },...(active.activityAt===undefined?{}:{activityAt:active.activityAt}) };
  };
  return {
    metrics, get state() { return snapshot(); }, get plan() { return active?.plan; },
    canStart(plan: CityLifePlan) {
      if(!cityLifePlanFitsSite(plan,plan))return false;
      const city = mobility(), targets = city ? plan.route.toReversed().filter(cell => city.visitTargets.has(key(cell))).slice(0, 1) : [];
      return !active && !!city && !!targets.length && (rejectedUntil.get(plan.taskId) ?? 0) <= plan.start
        && city.agents.some(actor => actor.kind === 'WALKER' && actor.age !== 'CHILD' && !actor.visit && !actor.carrier
          && actor.activity !== 'INSIDE' && targets.some(target => distance(actor.next, target) / actor.speed <= ARRIVAL_ROUTE_BUDGET_MS))
        && (plan.kind !== 'DRILL' || !!plan.responseCells?.length && city.agents.some(actor => actor.kind === 'CAR' && !actor.response && !actor.fleet))
        && director.canAcquire(lease(plan));
    },
    clear: () => finish(),
    start(plan: CityLifePlan, now: number): boolean {
      const city = mobility();
      if (active || !city || !Number.isFinite(now) || now < plan.start || now >= plan.start + plan.durationMs || plan.route.length < 2 || !cityLifePlanFitsSite(plan,plan)) return false;
      const travelBudget = ARRIVAL_ROUTE_BUDGET_MS - (now-plan.start);
      if (!(travelBudget>0)) return false;
      // These sites describe a single narrow approach, not an independent
      // multi-person activity pad. One resting worker leaves its own exit;
      // assigning a second target farther along can strand that visitor behind
      // the first body until the whole appointment expires.
      const targets = plan.route.toReversed().filter(cell => city.visitTargets.has(key(cell))).slice(0,1);
      if (!targets.length || plan.kind === 'DRILL' && !plan.responseCells?.length || !director.acquire(lease(plan))) return false;
      const adults = city.agents.filter(actor => actor.kind === 'WALKER' && actor.age !== 'CHILD').map(actor => actor.id);
      const actorIds = city.dispatchVisit(plan.id, targets, 1, 30_000, false, adults, travelBudget);
      active = { plan, city, actorIds, confirmed: false, phase: 'ARRIVING' };
      if (!actorIds.length) { finish();return false; }
      if (plan.kind === 'DRILL') {
        if (!city.dispatchResponse('FIRE', plan.responseCells!, 30_000, undefined, plan.id)) { finish();return false; }
        active.serviceId = city.agents.find(actor => actor.responseOwner === plan.id && actor.response === 'FIRE')?.id;
        if (!active.serviceId) { finish();return false; }
      }
      if (!director.claimActors(plan.id, [...actorIds, ...(active.serviceId ? [active.serviceId] : [])])) { finish();return false; }
      active.confirmed = true;
      metrics.started++;return true;
    },
    update(now: number, view: Rect, enabled: boolean): CityLifeScene | undefined {
      const current = active;if (!current) return;
      const { plan, city, actorIds, serviceId } = current, anchor = plan.route.at(-1)!;
      if (!enabled || mobility() !== city || !Number.isFinite(now) || now >= plan.start + plan.durationMs
        || anchor.x < view.minX || anchor.x > view.maxX || anchor.y < view.minY || anchor.y > view.maxY) { finish();return; }
      const people = city.agents.filter(actor => actorIds.includes(actor.id)), engine = serviceId && city.agents.find(actor => actor.id === serviceId);
      if (people.length !== actorIds.length || serviceId && (!engine || current.phase !== 'LEAVING' && engine.responseOwner !== plan.id)) { finish();return; }
      if (current.phase !== 'LEAVING' && people.some(actor => actor.visit?.id !== plan.id)) { finish();return; }
      if (current.phase === 'ARRIVING') {
        if (people.every(actor => actor.visit?.arrived) && (!serviceId || engine && engine.activity === 'REST')) {
          current.phase = 'ACTIVITY';current.activityAt = now;metrics.activities++;
        } else if (now - plan.start >= ARRIVAL_TIMEOUT_MS) { finish();return; }
      } else if (current.phase === 'ACTIVITY' && now - current.activityAt! >= CITY_RECIPE_WORK_MS) {
        current.phase = 'LEAVING';current.leavingAt = now;
        current.departureOrigins = new Map([...people, ...(engine ? [engine] : [])].map(actor => [actor.id, { ...actor.position }]));
        city.clearVisits(plan.id);
        if (serviceId) city.clearResponses(['FIRE'], serviceId, plan.id);
        for (const person of people) {
          const away = plan.route.filter(cell => city.visitTargets.has(key(cell)) && distance({ x: cell.x + .5, y: cell.y + .5 }, person.position) >= 4)
            .sort((a,b) => distance(b,person.position)-distance(a,person.position))[0];
          if (away) city.dispatchVisit(`${plan.id}:leave`, [away], 1, 2000, false, [person.id], 12_000);
        }
      } else if (current.phase === 'LEAVING') {
        if ([...people, ...(engine ? [engine] : [])].every(actor => !actor.carrier && distance(actor.position, current.departureOrigins!.get(actor.id)!) >= 3)) { finish(true);return; }
        if (now - current.leavingAt! >= 12_000) { finish();return; }
      }
      return snapshot();
    },
  };
}
