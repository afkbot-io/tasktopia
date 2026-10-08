import type { Rect } from '../shared/contracts';
import { incidentMode } from './task-incidents';
import type { CityMobility, CityMobilityAgent } from './city-mobility';
import { approachRoute, cellKey, compileEverydaySites, compileTransitStops, everydayPose, EVERYDAY_WINDOW_MS,
  openingKind, planEverydayEpisode, rainPose, type EverydayEpisode, type EverydayInput, type EverydayPose, type EverydaySite,
  type EverydayTask, type RainPose, type TransitStop } from './city-everyday-life';

export type TransitRun = { id: string; vehicleId: string; role: 'BUS' | 'SCHOOL_BUS'; stop: TransitStop; destination?: TransitStop;
  school?: { taskId: string; entrance: { x: number; y: number } };
  phase: 'ARRIVE' | 'BOARD' | 'TRAVEL' | 'ALIGHT'; since: number; start: number; boarded: number; alighted: number; arrivedAt?: number };
export type EverydayState = { pose?: EverydayPose; visitors: readonly CityMobilityAgent[]; areaReady: boolean;
  stops: readonly TransitStop[]; transit?: TransitRun; rain: RainPose; sheltered: ReadonlySet<string> };

/** Presentation director. All pedestrians, passengers and vehicles remain in
 * the shared fixed-step mobility simulation. No independent traffic timer. */
export function createEverydayController(cityId: string, mobility: () => CityMobility | undefined, sound: (cue: 'bell' | 'chirp' | 'whistle') => void) {
  let input: EverydayInput | undefined, sites: EverydaySite[] = [], stops: TransitStop[] = [];
  let kinds = '';
  let active: EverydayEpisode | undefined, run: TransitRun | undefined;
  let planned: EverydayEpisode | undefined;
  let players: string[] = [], nextPlay = 0, fireVehicle = '';
  let window = -1, transitWindow = -1, lastRain = '', schoolBusEpisode = '', schoolBusAttemptAt = 0, released = false, bell = false, enabledLast = false;
  let areaReady = false, reservations = new Set<string>(), reservedSignature = '';
  let lastSkip = '', lastNow = 0;
  const openings: EverydayEpisode[] = [], seen = new Set<string>();
  const schoolVisits = new Map<string, { until: number; taskId: string; entrance: { x: number; y: number } }>();
  const schoolArrivals = new Set<string>();
  const metrics = { episodes: 0, visitors: 0, boarded: 0, alighted: 0, schoolBuses: 0, regularBuses: 0, schoolBoarded: 0, schoolAlighted: 0, schoolArrived: 0, cancellations: 0 };
  const validEpisode = (episode: EverydayEpisode) => {
    if (!input || !episode.route.every(c => input!.walk.has(cellKey(c)) && !input!.blocked.has(cellKey(c)))) return false;
    const task = input.tasks.find(t => t.id === episode.taskId);
    if (!task || task.status !== 'COMPLETED' || task.stage !== 5 || incidentMode(task) !== 'NONE') return false;
    if (episode.kind.startsWith('OPEN_')) return openingKind(task) === episode.kind && !!task.accessPath[0] && cellKey(task.accessPath[0]) === cellKey(episode.route.at(-1)!);
    const sameCells = (a: readonly { x: number; y: number }[], b: readonly { x: number; y: number }[]) => a.length === b.length && a.every((c, i) => cellKey(c) === cellKey(b[i]!));
    return sites.some(site => site.taskId === episode.taskId && site.kind === episode.kind && sameCells(site.route, episode.route) && sameCells(site.area, episode.area));
  };
  const validSchool = (school: NonNullable<TransitRun['school']>) => {
    const current = input?.tasks.find(task => task.id === school.taskId);
    return !!current && current.status === 'COMPLETED' && current.stage === 5 && incidentMode(current) === 'NONE'
      && ['OPEN_SCHOOL', 'OPEN_KINDERGARTEN'].includes(openingKind(current)) && !!current.accessPath[0]
      && cellKey(current.accessPath[0]) === cellKey(school.entrance);
  };
  const rebuildReservations = (enabled: boolean) => {
    const cells = enabled ? [...stops.flatMap(stop => stop.shelter), ...(active?.kind === 'SPORT' ? active.area.filter(c => !active!.playTargets?.some(target => cellKey(c) === cellKey(target))) : active?.area ?? [])] : [];
    const signature = cells.map(cellKey).sort().join(';');
    if (signature !== reservedSignature) { reservedSignature = signature; reservations = new Set(cells.map(cellKey)); }
  };
  const endEpisode = () => {
    if (active) mobility()?.clearVisits(active.id);
    if (fireVehicle) mobility()?.clearResponses(['FIRE'], fireVehicle);
    players = []; fireVehicle = '';
    active = undefined; released = false; bell = false; areaReady = false;
  };
  const endTransit = () => {
    if (run) {
      mobility()?.alightVisit(run.vehicleId, (run.destination ?? run.stop).queue);
      mobility()?.clearVisits(run.id);
      mobility()?.clearResponses([run.role], run.vehicleId);
    }
    run = undefined;
  };
  const clear = () => { transitWindow = Math.floor(lastNow / 60_000); endEpisode(); endTransit(); for (const id of schoolVisits.keys()) mobility()?.clearVisits(id); schoolVisits.clear(); mobility()?.clearVisits(`shelter:${lastRain}`); openings.length = 0; planned = undefined; rebuildReservations(false); };
  const startEpisode = (episode: EverydayEpisode, economy: boolean) => {
    const city = mobility(); if (!city) return;
    active = episode; released = false; bell = false; areaReady = false; schoolBusAttemptAt = 0;
    if ((episode.kind === 'SCHOOL' || episode.kind === 'KINDERGARTEN') && run?.role === 'BUS') endTransit();
    const indoors = ['SCHOOL', 'KINDERGARTEN', 'OPEN_SCHOOL', 'OPEN_KINDERGARTEN', 'OPEN_SHOP'].includes(episode.kind);
    const target = episode.area.length ? episode.route[Math.max(0, episode.route.length - 3)]! : episode.route.at(-1)!;
    const targets = episode.targets?.length ? episode.targets : [target];
    const count = economy ? 3 : episode.kind === 'KINDERGARTEN' || episode.kind === 'OPEN_KINDERGARTEN' ? 4 : 6;
    let ids: string[];
    if (episode.kind.includes('SCHOOL') || episode.kind.includes('KINDERGARTEN')) {
      const children = city.agents.filter(a => a.age === 'CHILD').map(a => a.id), adults = city.agents.filter(a => a.age === 'ADULT').map(a => a.id);
      ids = [...city.dispatchVisit(episode.id, targets, economy ? 2 : 3, 9500, true, children),
        ...city.dispatchVisit(episode.id, targets, episode.kind.includes('KINDERGARTEN') && !economy ? 2 : 1, 9500, true, adults)];
    } else if (episode.kind === 'SPORT') {
      players = city.dispatchVisit(episode.id, episode.playTargets ?? [], 2, 800, false);
      ids = [...players, ...city.dispatchVisit(episode.id, targets, Math.max(1, count - players.length), 28_000, false)];
    } else ids = city.dispatchVisit(episode.id, targets, count, indoors ? 9500 : 28_000, indoors);
    if (episode.kind === 'SPORT') { nextPlay = episode.start + 11_000; }
    if (episode.kind === 'OPEN_FIRE') {
      const anchor = episode.route.at(-1)!;
      const curbs = [...input!.roads.values()].filter(c => Math.abs(c.x - anchor.x) + Math.abs(c.y - anchor.y) <= 8);
      const responders = new Set(city.agents.filter(a => a.response).map(a => a.id));
      if (city.dispatchResponse('FIRE', curbs, 20_000)) fireVehicle = city.agents.find(a => a.response === 'FIRE' && !responders.has(a.id))?.id ?? '';
    }
    metrics.visitors += ids.length; metrics.episodes++;
  };
  const startTransit = (now: number, economy: boolean) => {
    const city = mobility(); if (!city || stops.length < 2) return;
    const school = active && (active.kind === 'SCHOOL' || active.kind === 'KINDERGARTEN') ? active : undefined;
    const anchor = school?.route.at(-1);
    const targetStops = [...stops].sort((a, b) => anchor
      ? Math.abs(a.lane.x - anchor.x) + Math.abs(a.lane.y - anchor.y) - Math.abs(b.lane.x - anchor.x) - Math.abs(b.lane.y - anchor.y)
      : a.id.localeCompare(b.id));
    const role = school && anchor && Math.abs(targetStops[0]!.lane.x - anchor.x) + Math.abs(targetStops[0]!.lane.y - anchor.y) < 24 ? 'SCHOOL_BUS' : 'BUS';
    const destinations = role === 'SCHOOL_BUS' && anchor
      ? targetStops.filter(stop => Math.abs(stop.lane.x - anchor.x) + Math.abs(stop.lane.y - anchor.y) < 24) : [];
    const pairs = destinations.length ? destinations.flatMap(destination => targetStops.filter(stop => stop.id !== destination.id).map(stop => ({ stop, next: destination })))
      : targetStops.map(stop => ({ stop, next: stops.find(other => other.id !== stop.id && city.canDrive(stop.lane, other.lane)) }));
    const id = `${cityId}:bus:${Math.floor(now / 60_000)}`;
    const riders = role === 'SCHOOL_BUS' ? city.agents.filter(a => a.age === 'CHILD').map(a => a.id) : undefined;
    for (const { stop, next } of pairs) {
      if (!next || !city.canDrive(stop.lane, next.lane)) continue;
      // Select a source with actual reachable passengers before leasing a
      // vehicle. The nearest school curb may be disconnected from all children.
      if (!city.dispatchVisit(id, stop.queue, school?.kind === 'KINDERGARTEN' ? economy ? 1 : 2 : economy ? 2 : 4, 30_000, false, riders).length) continue;
      if (school?.kind === 'KINDERGARTEN') city.dispatchVisit(id, stop.queue, economy ? 1 : 2, 30_000, false, city.agents.filter(a => a.age === 'ADULT').map(a => a.id));
      const responders = new Set(city.agents.filter(a => a.response).map(a => a.id));
      if (!city.dispatchResponse(role, [stop.lane], 30_000)) { city.clearVisits(id); continue; }
      const vehicle = city.agents.find(a => a.response === role && !responders.has(a.id))!;
      run = { id, vehicleId: vehicle.id, role, stop, destination: next, phase: 'ARRIVE', since: now, start: now, boarded: 0, alighted: 0,
        school: school?.taskId && anchor ? { taskId: school.taskId, entrance: anchor } : undefined };
      if (role === 'SCHOOL_BUS') metrics.schoolBuses++; else metrics.regularBuses++;
      break;
    }
  };
  const updateTransit = (now: number) => {
    const city = mobility(); if (!run || !city) return;
    if (now - run.start >= 80_000) { endTransit(); return; }
    const vehicle = city.agents.find(a => a.id === run!.vehicleId);
    if (!vehicle) { endTransit(); return; }
    const at = (stop: TransitStop) => vehicle.activity === 'REST' && Math.hypot(vehicle.position.x - stop.lane.x - .5, vehicle.position.y - stop.lane.y - .5) < .1;
    if (run.phase === 'ARRIVE' && at(run.stop)) { run.phase = 'BOARD'; run.since = now; run.arrivedAt = now; }
    if (run.phase === 'BOARD') {
      const boarded = city.boardVisit(run.id, run.vehicleId); run.boarded += boarded; metrics.boarded += boarded;
      if (run.role === 'SCHOOL_BUS') metrics.schoolBoarded += boarded;
      if (now - run.since >= (run.boarded ? 5500 : 24000)) {
        const next = (run.destination ? [run.destination] : stops).find(stop => stop.id !== run!.stop.id && city.dispatchResponse(run!.role, [stop.lane], 12_000, run!.vehicleId));
        if (next) { run.destination = next; run.phase = 'TRAVEL'; run.since = now; }
        else endTransit();
      }
    }
    if (run?.phase === 'TRAVEL' && run.destination && at(run.destination)) { run.phase = 'ALIGHT'; run.since = now; }
    if (run?.phase === 'ALIGHT' && run.destination) {
      const ids = city.agents.filter(a => a.carrier === run!.vehicleId).map(a => a.id);
      const alighted = city.alightVisit(run.vehicleId, run.destination.queue); run.alighted += alighted; metrics.alighted += alighted;
      if (run.role === 'SCHOOL_BUS') metrics.schoolAlighted += alighted;
      const school = run.school;
      if (alighted && school && validSchool(school)) {
        const visit = `${run.id}:school`;
        const assigned = city.dispatchVisit(visit, [school.entrance], alighted, 9500, true, ids.filter(id => !city.agents.find(a => a.id === id)?.carrier));
        if (assigned.length) schoolVisits.set(visit, { ...school, until: now + 60_000 });
      }
      if (now - run.since >= 6000) endTransit();
    }
  };
  return {
    compile(next: EverydayInput) {
      const first = !input;
      input = next; sites = compileEverydaySites(next); stops = compileTransitStops({ ...next, canDrive: mobility()?.canDrive });
      kinds = [...new Set(sites.map(site => site.kind))].sort().join(',');
      if (first) window = -1;
      if (active && !validEpisode(active)) { lastSkip = 'invalidated'; endEpisode(); metrics.cancellations++; }
      if (planned && !validEpisode(planned)) planned = undefined;
      for (const [id, school] of schoolVisits) if (!validSchool(school)) { mobility()?.clearVisits(id); schoolVisits.delete(id); }
      if (run && (run.school && !validSchool(run.school) || !stops.some(stop => stop.id === run!.stop.id) || run.destination && !stops.some(stop => stop.id === run!.destination!.id))) endTransit();
      rebuildReservations(enabledLast);
    },
    open(task: EverydayTask, version: string, now: number) {
      const current = input?.tasks.find(candidate => candidate.id === task.id);
      if (!input || !current || !enabledLast || task.status !== 'COMPLETED' || task.stage !== 5 || incidentMode(task) !== 'NONE' || seen.has(version)
        || current.status !== 'COMPLETED' || current.stage !== 5 || incidentMode(current) !== 'NONE') return false;
      if (!task.accessPath[0] || !current.accessPath[0] || cellKey(task.accessPath[0]) !== cellKey(current.accessPath[0])) return false;
      const route = approachRoute(current.accessPath[0], input.walk, new Set([...input.blocked, ...input.roads.keys()]));
      if (!route.length) return false;
      seen.add(version); while (seen.size > 128) seen.delete(seen.values().next().value!);
      // A confirmed opening takes priority over a cosmetic scheduled episode.
      // Later openings wait only for another opening, in a bounded queue.
      if (active && !active.kind.startsWith('OPEN_')) endEpisode();
      openings.push({ id: `opening:${version}`, taskId: task.id, kind: openingKind(current), route, area: [], start: now, end: now + 44_000 });
      while (openings.length > 3) openings.shift(); return true;
    },
    clear,
    preemptRoadResponse(required: number) {
      if (fireVehicle) { mobility()?.clearResponses(['FIRE'], fireVehicle); fireVehicle = ''; }
      if (required > 1) endTransit();
    },
    reservedCells: () => reservations,
    get sites() { return sites; },
    get kinds() { return kinds; },
    get planned() { return planned; },
    get lastSkip() { return lastSkip; },
    get metrics() { return { ...metrics, schoolVisits: schoolVisits.size }; },
    update(now: number, view: Rect, options: { enabled: boolean; economy: boolean; busy: ReadonlySet<string>; roadBusy: boolean }): EverydayState {
      const city = mobility(), windowNow = Math.floor(now / EVERYDAY_WINDOW_MS);
      if (Number.isFinite(now)) lastNow = now;
      if (!options.enabled || !city || !input || !Number.isFinite(now)) {
        if (enabledLast) { clear(); window = windowNow; transitWindow = Math.floor(now / 60_000); }
        enabledLast = false;
        return { visitors: [], stops: [], areaReady: false, rain: { phase: 'DRY', intensity: 0, puddles: 0, id: '' }, sheltered: new Set() };
      }
      // Availability may return before this window starts (e.g. an LOD
      // transition). Preserve that future event; never replay a past window.
      if (!enabledLast && now < windowNow * EVERYDAY_WINDOW_MS + 8000) window = -1;
      enabledLast = true;
      for (const [id, school] of schoolVisits) if (now >= school.until) { city.clearVisits(id); schoolVisits.delete(id); }
      for (const actor of city.agents) if (actor.visit?.arrived && schoolVisits.has(actor.visit.id)) {
        const arrival = `${actor.visit.id}:${actor.id}`;
        if (!schoolArrivals.has(arrival)) { schoolArrivals.add(arrival); metrics.schoolArrived++; }
      }
      while (schoolArrivals.size > 32) schoolArrivals.delete(schoolArrivals.values().next().value!);
      if (window !== windowNow) { window = windowNow; planned = planEverydayEpisode(cityId, sites, now); }
      if (active && (now >= active.end || [...active.route, ...active.area].some(c => options.busy.has(cellKey(c))))) { lastSkip = now >= active.end ? 'expired' : 'busy'; endEpisode(); metrics.cancellations++; }
      while (openings[0] && (now - openings[0].start > 150_000 || !validEpisode(openings[0]))) openings.shift();
      if (openings.length && !active) startEpisode({ ...openings.shift()!, start: now, end: now + 44_000 }, options.economy);
      if (!active && planned && now >= planned.start) {
        const plan = planned; planned = undefined;
        lastSkip = now - plan.start >= 4000 ? 'late' : !everydayPose(plan, now, view) ? 'offscreen'
          : [...plan.route, ...plan.area].some(c => options.busy.has(cellKey(c))) ? 'busy' : '';
        if (now - plan.start < 4000 && everydayPose(plan, now, view)
          && ![...plan.route, ...plan.area].some(c => options.busy.has(cellKey(c)))) startEpisode(plan, options.economy);
      }
      const pose = everydayPose(active, now, view);
      if (pose?.kind === 'SPORT' && pose.phase === 'ACTIVITY' && now >= nextPlay && pose.playTargets && pose.playTargets.length >= 2) {
        const phase = Math.floor((now - pose.start) / 4000) % 2;
        for (const [i, id] of players.entries()) city.dispatchVisit(pose.id, [pose.playTargets[(i + phase) % pose.playTargets.length]!], 1, 800, false, [id]);
        nextPlay = now + 4000;
      }
      if (pose?.phase === 'LEAVE' && !released) { city.clearVisits(pose.id); released = true; }
      const visitors = active ? city.agents.filter(a => a.visit?.id === active!.id) : [];
      if (pose && !bell && visitors.some(a => a.visit?.arrived)) {
        if (pose.kind.includes('SCHOOL') || pose.kind.includes('KINDERGARTEN')) sound('bell');
        else if (pose.kind === 'BIRDS') sound('chirp'); else if (pose.kind === 'SPORT') sound('whistle');
        bell = true;
      }
      if (active?.area.length) areaReady = !city.agents.some(a => a.activity !== 'INSIDE'
        && !(active!.kind === 'SPORT' && a.visit?.id === active!.id)
        && active!.area.some(c => Math.abs(a.position.x - c.x - .5) < .8 && Math.abs(a.position.y - c.y - .5) < .8));
      rebuildReservations(true);
      const busWindow = Math.floor(now / 60_000);
      if (options.roadBusy && fireVehicle) { city.clearResponses(['FIRE'], fireVehicle); fireVehicle = ''; }
      if (active && (active.kind === 'SCHOOL' || active.kind === 'KINDERGARTEN') && schoolBusEpisode !== active.id && !options.roadBusy && now >= schoolBusAttemptAt) {
        schoolBusAttemptAt = now + 5000;
        if (run?.role === 'BUS') endTransit();
        // The walking group gets its own residents. Retry after their short
        // indoor activity instead of consuming the episode's entire audience.
        if (!run) { startTransit(now, options.economy); if (run) schoolBusEpisode = active.id; }
      }
      if (!run && !options.roadBusy && busWindow !== transitWindow && now % 60_000 < 4000) { transitWindow = busWindow; startTransit(now, options.economy); }
      updateTransit(now);
      const rain = rainPose(cityId, now), sheltered = new Set<string>();
      if (rain.phase === 'RAIN' && lastRain !== rain.id) {
        lastRain = rain.id;
        if (stops[0]) city.dispatchVisit(`shelter:${rain.id}`, stops[0].queue, options.economy ? 2 : 4, 14_000, false);
      }
      for (const actor of city.agents) if (stops.some(stop => stop.queue.some(c => Math.hypot(actor.position.x - c.x - .5, actor.position.y - c.y - .5) < 1))) sheltered.add(actor.id);
      return { pose, visitors, areaReady, stops, transit: run && { ...run }, rain, sheltered };
    },
  };
}
