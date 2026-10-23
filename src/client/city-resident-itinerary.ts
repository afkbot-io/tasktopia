import type { Cell } from "../shared/contracts";
import { BUILDING_CATALOG } from "../shared/catalog";
import type { CityMobility, CityMobilityAgent } from "./city-mobility";
import type { EverydayTask, TransitStop } from "./city-everyday-life";
import { incidentMode } from "./task-incidents";

export type ResidentItineraryInput = { tasks: readonly EverydayTask[]; stops: readonly TransitStop[];
  parks: readonly { taskId: string; targets: readonly Cell[] }[]; walk: ReadonlyMap<string, Cell> };
export type ResidentItineraryOptions = { enabled: boolean; economy: boolean; hidden?: boolean; reducedMotion?: boolean };
export type ResidentItinerarySnapshot = { actorId: string; homeTaskId: string; targetTaskId: string | null; stopId: string | null;
  phase: "HOME" | "STOP" | "DESTINATION" | "PARK"; position: Cell; arrived: boolean; inside: boolean };
type Site = { id: string; targets: Cell[] };
type Stage = { phase: ResidentItinerarySnapshot["phase"]; taskId: string | null; stopId: string | null; targets: Cell[]; indoors: boolean; stayMs: number; optional: boolean };
type Journey = { city: CityMobility; actorId: string; homeTaskId: string; destinationKind: "school" | "work"; stages: Stage[]; index: number; visitId: string; arrived: boolean; legStartedAt: number };
const catalog = new Map(BUILDING_CATALOG.map(entry => [entry.key, entry]));
const key = (cell: Cell) => `${cell.x},${cell.y}`;
const distance = (a: Cell, b: Cell) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const ready = (task: EverydayTask) => task.status === "COMPLETED" && task.stage === 5 && incidentMode(task) === "NONE";
const signature = (cells: readonly Cell[]) => cells.map(key).join(";");
const nearest = (sites: readonly Site[], from: Cell) => sites.reduce<Site | undefined>((best, site) => !best
  || distance(site.targets[0]!, from) < distance(best.targets[0]!, from) ? site : best, undefined);

/** Bounded ownership of existing visits only; CityMobility owns all movement. */
export function createCityResidentItinerary(options: { mobility: () => CityMobility | undefined; limit: () => number }) {
  let homes: Site[] = [], schools: Site[] = [], workplaces: Site[] = [], stops: Site[] = [], parks: Site[] = [];
  const journeys = new Map<string, Journey>(); const cooldowns = new Map<string, number>();
  let serial = 0; let lastNow: number | undefined; let nextUpdate = -Infinity; let lastCity: CityMobility | undefined;
  const counters = { completed: 0, cancelled: 0, dispatches: 0, failedDispatches: 0, skippedOptional: 0, updates: 0 };
  const cancel = (journey: Journey, completed = false) => {
    const actor = journey.city.agents.find(agent => agent.id === journey.actorId);
    // A transport/response claim is owned by that system, even if it retained
    // the previous visit token. Never alight or clear somebody else's visitor.
    if (actor?.visit?.id === journey.visitId && !actor.carrier && !actor.response) journey.city.clearVisits(journey.visitId);
    journeys.delete(journey.actorId); cooldowns.set(journey.actorId, (lastNow ?? 0) + 10_000);
    if (completed) counters.completed++; else counters.cancelled++;
  };
  const clear = () => {
    for (const journey of journeys.values()) cancel(journey);
    journeys.clear(); cooldowns.clear(); lastNow = undefined; nextUpdate = -Infinity;
  };
  const currentSite = (stage: Stage, journey: Journey) => (stage.phase === "HOME" ? homes : stage.phase === "STOP" ? stops
    : stage.phase === "PARK" ? parks : journey.destinationKind === "school" ? schools : workplaces).find(site => site.id === (stage.taskId ?? stage.stopId));
  const valid = (journey: Journey) => journey.stages.every(stage => {
    const site = currentSite(stage, journey);
    return site && signature(site.targets) === signature(stage.targets);
  });
  const dispatch = (journey: Journey, now: number): boolean => {
    // Only optional stages can be skipped after a real bounded path failure.
    for (let attempts = 0; attempts < 3 && journey.index < journey.stages.length; attempts++) {
      const stage = journey.stages[journey.index]!;
      const id = `resident:itinerary:${++serial}:${journey.actorId}:${journey.index}`;
      const ids = journey.city.dispatchVisit(id, stage.targets, 1, stage.stayMs, stage.indoors, [journey.actorId]);
      if (ids.includes(journey.actorId)) {
        journey.visitId = id; journey.arrived = false; journey.legStartedAt = now; counters.dispatches++; return true;
      }
      counters.failedDispatches++;
      if (!stage.optional) return false;
      counters.skippedOptional++; journey.index++;
    }
    return false;
  };
  const plan = (city: CityMobility, actor: CityMobilityAgent, now: number): Journey | undefined => {
    const home = nearest(homes, actor.current);
    const destination = home && nearest(actor.age === "CHILD" ? schools : workplaces, home.targets[0]!);
    if (!home || !destination || home.id === destination.id) return;
    const stop = nearest(stops, home.targets[0]!); const park = nearest(parks, destination.targets[0]!);
    const stage = (phase: Stage["phase"], site: Site, indoors: boolean, stayMs: number, optional = false): Stage => ({ phase,
      taskId: phase === "STOP" ? null : site.id, stopId: phase === "STOP" ? site.id : null, targets: site.targets, indoors, stayMs, optional });
    const stages = [stage("HOME", home, true, 1000), ...(stop ? [stage("STOP", stop, false, 1000, true)] : []),
      stage("DESTINATION", destination, true, 8000), ...(park ? [stage("PARK", park, false, 3000, true)] : []), stage("HOME", home, true, 2500)];
    const journey: Journey = { city, actorId: actor.id, homeTaskId: home.id, destinationKind: actor.age === "CHILD" ? "school" : "work",
      stages, index: 0, visitId: "", arrived: false, legStartedAt: now };
    if (dispatch(journey, now)) return journey;
    cooldowns.set(actor.id, now + 10_000);
  };
  return {
    compile(input: ResidentItineraryInput) {
      const tasks = new Map(input.tasks.map(task => [task.id, task]));
      const targets = (cells: readonly Cell[], limit: number) => cells.filter(cell => Number.isFinite(cell.x) && Number.isFinite(cell.y) && input.walk.has(key(cell)))
        .slice(0, limit).map(cell => ({ x: cell.x, y: cell.y }));
      const sites = input.tasks.filter(task => ready(task) && task.visualKind === "BUILDING" && task.accessPath[0] && input.walk.has(key(task.accessPath[0])))
        .map(task => { const entry = catalog.get(task.visualAssetKey); return { task, entry,
          role: task.serviceRole ?? entry?.serviceRole ?? (entry?.educationKind ? "EDUCATION" : undefined),
          site: { id: task.id, targets: targets([task.accessPath[0]!], 1) } }; })
        .sort((a,b) => a.site.id.localeCompare(b.site.id));
      homes = sites.filter(({ role, entry }) => !role && (entry?.category === "HOUSE" || entry?.category === "HIGHRISE")).slice(0,128).map(item => item.site);
      schools = sites.filter(({ role }) => role === "EDUCATION").slice(0,32).map(item => item.site);
      workplaces = sites.filter(({ role, entry }) => role !== "EDUCATION" && (Boolean(role) || entry?.category === "COMMERCIAL" || entry?.category === "CIVIC")).slice(0,128).map(item => item.site);
      stops = input.stops.map(stop => ({ id: stop.id, targets: targets(stop.queue, 3) })).filter(site => site.targets.length).slice(0,64);
      parks = input.parks.flatMap(park => {
        const task = tasks.get(park.taskId); const area = targets(park.targets, 8);
        return task && ready(task) && task.visualKind === "PARK" && area.length ? [{ id: task.id, targets: area }] : [];
      }).slice(0,64);
      for (const journey of journeys.values()) if (!valid(journey)) cancel(journey);
    },
    update(now: number, settings: ResidentItineraryOptions) {
      if (!settings.enabled || settings.hidden || settings.reducedMotion || !Number.isFinite(now)) { clear(); return; }
      const city = options.mobility();
      if (!city) { clear(); lastCity = undefined; return; }
      if (lastCity && city !== lastCity) { clear(); lastCity = city; return; }
      lastCity = city;
      if (lastNow !== undefined && now < lastNow) { clear(); lastNow = now; nextUpdate = now + 250; return; }
      lastNow = now;
      if (now < nextUpdate) return;
      nextUpdate = now + 250; counters.updates++;
      const requested = options.limit();
      const cap = Math.max(0, Math.min(settings.economy ? 2 : 4, Number.isFinite(requested) ? Math.floor(requested) : 0,
        Math.floor(city.agents.filter(actor => actor.kind === "WALKER").length / 3)));
      for (const journey of [...journeys.values()].slice(cap)) cancel(journey);
      const actors = new Map(city.agents.map(actor => [actor.id, actor]));
      for (const [actorId, until] of cooldowns) if (until <= now || !actors.has(actorId)) cooldowns.delete(actorId);
      for (const journey of journeys.values()) {
        const actor = actors.get(journey.actorId);
        if (!actor || actor.carrier || actor.response || !valid(journey) || actor.visit && actor.visit.id !== journey.visitId) { cancel(journey); continue; }
        // This also bounds an occupied indoor exit after its visit expired.
        // Cancelling ownership leaves CityMobility waiting for the safe pose.
        if (now - journey.legStartedAt > 65_000) { cancel(journey); continue; }
        if (actor.visit?.id === journey.visitId) {
          if (actor.visit.arrived) journey.arrived = true;
          continue;
        }
        if (!journey.arrived) { cancel(journey); continue; }
        if (actor.activity === "INSIDE") continue; // Wait for the real safe exit.
        journey.index++;
        if (journey.index >= journey.stages.length) { cancel(journey, true); continue; }
        if (!dispatch(journey, now)) cancel(journey);
      }
      let attempts = 0;
      for (const actor of actors.values()) {
        if (journeys.size >= cap || attempts >= 8) break;
        if (journeys.has(actor.id) || cooldowns.has(actor.id) || actor.kind !== "WALKER" || actor.carrier || actor.response || actor.visit || actor.activity === "INSIDE") continue;
        attempts++;
        const journey = plan(city, actor, now);
        if (journey) journeys.set(actor.id, journey);
      }
    },
    clear,
    get snapshots(): ResidentItinerarySnapshot[] {
      return [...journeys.values()].flatMap(journey => {
        const actor = journey.city.agents.find(item => item.id === journey.actorId); const stage = journey.stages[journey.index];
        return actor && stage ? [{ actorId: actor.id, homeTaskId: journey.homeTaskId, targetTaskId: stage.taskId, stopId: stage.stopId,
          phase: stage.phase, position: { ...actor.position }, arrived: journey.arrived || actor.visit?.arrived === true, inside: actor.activity === "INSIDE" }] : [];
      });
    },
    get metrics() { return { ...counters, active: journeys.size, homes: homes.length, schools: schools.length, workplaces: workplaces.length, stops: stops.length, parks: parks.length }; },
  };
}
