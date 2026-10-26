import { describe, expect, it, vi } from "vitest";
import { createCityResidentItinerary } from "../src/client/city-resident-itinerary";
import { createCityMobility } from "../src/client/city-mobility";
import type { Cell } from "../src/shared/contracts";
import type { EverydayTask, TransitStop } from "../src/client/city-everyday-life";

function fixture(limit = 1) {
  const walk = new Map<string, Cell>();
  for (let n = 0; n <= 12; n++) for (const cell of [{ x: n, y: 0 }, { x: n, y: 12 }, { x: 0, y: n }, { x: 12, y: n }]) walk.set(`${cell.x},${cell.y}`, cell);
  const task = (id: string, visualAssetKey: string, x: number): EverydayTask => ({ id, status: "COMPLETED", stage: 5, visualKind: "BUILDING",
    visualAssetKey, accessPath: [{ x, y: 0 }], footprint: [{ x, y: -1 }], workItemType: "TASK" });
  const home = task("home", "compact-apartment-v1", 0), school = task("school", "compact-modern-school-v1", 6), work = task("work", "compact-shop-v1", 9);
  const park = { ...task("park", "urban-formal", 11), visualKind: "PARK" as const };
  const stop: TransitStop = { id: "stop", lane: { x: 3, y: -1 }, shelter: [], queue: [{ x: 3, y: 0 }], route: [], direction: "horizontal" };
  const city = createCityMobility({ roads: new Map(), walkGraph: walk, crosswalks: new Set(), activityCells: new Set(walk.keys()),
    buildingEntrances: new Set(["0,0", "6,0", "9,0"]), seed: 17, carLimit: 0, walkerLimit: 12 });
  const input = { tasks: [home, school, work, park], stops: [stop], parks: [{ taskId: park.id, targets: [{ x: 11, y: 0 }] }], walk };
  const itinerary = createCityResidentItinerary({ mobility: () => city, limit: () => limit }); itinerary.compile(input);
  return { city, itinerary, input, home, school, work, park, stop };
}
const options = { enabled: true, economy: false };

describe("real resident itineraries", () => {
  it("physically visits home, stop, school, park and home using the original resident IDs", () => {
    const { city, itinerary } = fixture(); const original = city.agents.map(agent => agent.id); const phases = new Set<string>();
    for (let now = 0; now <= 220_000 && itinerary.metrics.completed === 0; now += 100) {
      itinerary.update(now, options);
      for (const snapshot of itinerary.snapshots) {
        phases.add(snapshot.phase); expect(original).toContain(snapshot.actorId);
        const actor = city.agents.find(agent => agent.id === snapshot.actorId)!;
        expect(snapshot.position).toEqual(actor.position);
        if (snapshot.phase === "DESTINATION" && actor.age === "CHILD") expect(snapshot.targetTaskId).toBe("school");
      }
      city.advance(100);
    }
    expect(itinerary.metrics.completed).toBeGreaterThan(0);
    expect([...phases]).toEqual(expect.arrayContaining(["HOME", "STOP", "DESTINATION", "PARK"]));
    expect(city.agents.map(agent => agent.id)).toEqual(original);
  });

  it("caps the pool, throttles updates and sends adults to actual work rather than inventing a destination", () => {
    const { city, itinerary } = fixture(99); const targets = new Map<string, string | null>();
    for (let now = 0; now <= 160_000; now += 50) {
      itinerary.update(now, options);
      expect(itinerary.snapshots.length).toBeLessThanOrEqual(4);
      for (const snapshot of itinerary.snapshots) if (snapshot.phase === "DESTINATION") targets.set(city.agents.find(agent => agent.id === snapshot.actorId)!.age!, snapshot.targetTaskId);
      city.advance(50);
    }
    expect(targets.get("ADULT")).toBe("work");
    expect(itinerary.metrics.updates).toBeLessThanOrEqual(641);
    itinerary.update(160_250, { ...options, economy: true }); expect(itinerary.snapshots.length).toBeLessThanOrEqual(2);
  });

  it("does not scan the resident pool on rendering frames between scheduled updates", () => {
    const f = fixture(), agents = vi.spyOn(f.city, "agents", "get"); f.itinerary.update(0, options); agents.mockClear();
    for (let now = 1; now < 250; now++) f.itinerary.update(now, options);
    expect(agents).not.toHaveBeenCalled();
    f.itinerary.update(250, options); expect(agents).toHaveBeenCalled();
  });

  it("cancels changed or unfinished geometry, hidden/reduced/disabled modes and backwards clocks idempotently", () => {
    const f = fixture(); f.itinerary.update(1000, options); expect(f.itinerary.snapshots).not.toHaveLength(0);
    const clear = vi.spyOn(f.city, "clearVisits");
    f.itinerary.compile({ ...f.input, tasks: f.input.tasks.map(task => task.id === f.home.id ? { ...task, stage: 4 } : task) });
    expect(f.itinerary.snapshots).toHaveLength(0); expect(clear).toHaveBeenCalled();
    f.itinerary.compile(f.input); f.itinerary.update(2000, options); f.itinerary.update(1, options);
    expect(f.itinerary.snapshots).toHaveLength(0);
    for (const mode of [{ enabled: false }, { hidden: true }, { reducedMotion: true }]) {
      f.itinerary.update(3000, options); f.itinerary.update(3001, { ...options, ...mode }); expect(f.itinerary.snapshots).toHaveLength(0);
    }
    f.itinerary.clear(); const before = clear.mock.calls.length; f.itinerary.clear(); expect(clear).toHaveBeenCalledTimes(before);
    expect(clear.mock.calls.every(([id]) => id?.startsWith("resident:itinerary:"))).toBe(true);
  });

  it("cancels a child's school route when that exact building becomes a commercial destination", () => {
    const f = fixture(); f.itinerary.update(0, options);
    const actorId = f.itinerary.snapshots[0]!.actorId;
    expect(f.city.agents.find(actor => actor.id === actorId)?.age).toBe("CHILD");
    f.itinerary.compile({ ...f.input, tasks: f.input.tasks.map(task => task.id === "school" ? { ...task, visualAssetKey: "compact-shop-v1" } : task) });
    expect(f.itinerary.snapshots.find(snapshot => snapshot.actorId === actorId)).toBeUndefined();
  });

  it("honors an explicit role change over the unchanged authored school asset", () => {
    const f = fixture(); f.itinerary.update(0, options); const actorId = f.itinerary.snapshots[0]!.actorId;
    f.itinerary.compile({ ...f.input, tasks: f.input.tasks.map(task => task.id === 'school' ? { ...task, serviceRole: 'SHOP' as const } : task) });
    expect(f.itinerary.snapshots.find(snapshot => snapshot.actorId === actorId)).toBeUndefined();
    expect(f.itinerary.metrics.schools).toBe(0); expect(f.itinerary.metrics.workplaces).toBe(2);
  });

  it("uses the same explicit-role priority for homes and workplaces", () => {
    const f = fixture();
    f.itinerary.compile({ ...f.input, tasks: f.input.tasks.map(task => task.id === 'home' ? { ...task, serviceRole: 'SHOP' as const } : task) });
    expect(f.itinerary.metrics.homes).toBe(0); expect(f.itinerary.metrics.workplaces).toBe(2);
    f.itinerary.compile({ ...f.input, tasks: f.input.tasks.map(task => task.id === 'work' ? { ...task, serviceRole: 'EDUCATION' as const } : task) });
    expect(f.itinerary.metrics.homes).toBe(1); expect(f.itinerary.metrics.workplaces).toBe(0); expect(f.itinerary.metrics.schools).toBe(2);
  });

  it("releases ownership when a priority system claims a resident without clearing its foreign visit", () => {
    const f = fixture(); f.itinerary.update(0, options);
    const actorId = f.itinerary.snapshots[0]!.actorId, ownVisit = f.city.agents.find(actor => actor.id === actorId)!.visit!.id;
    f.city.clearVisits(ownVisit);
    expect(f.city.dispatchVisit("transport:foreign", [{ x: 3, y: 0 }], 1, 10_000, false, [actorId])).toContain(actorId);
    const clear = vi.spyOn(f.city, "clearVisits"); f.itinerary.update(300, options);
    expect(f.itinerary.snapshots.find(snapshot => snapshot.actorId === actorId)).toBeUndefined();
    expect(f.city.agents.find(actor => actor.id === actorId)?.visit?.id).toBe("transport:foreign");
    expect(clear).not.toHaveBeenCalled();
  });

  it("does not alight or clear a real resident boarded by an external transport", () => {
    const f = fixture(); let now = 0;
    for (; now < 5000; now += 100) { f.itinerary.update(now, options); if (f.itinerary.snapshots[0]?.arrived) break; f.city.advance(100); }
    const actor = f.city.agents.find(item => item.id === f.itinerary.snapshots[0]!.actorId)!;
    expect(actor.visit?.arrived).toBe(true);
    f.city.updateExternalCarrier({ id: "transport:test", position: actor.position, doors: [actor.position], boardingCells: [actor.current], doorsOpen: true, capacity: 1 });
    expect(f.city.boardExternalVisit(actor.visit!.id, "transport:test")).toBe(1);
    const clear = vi.spyOn(f.city, "clearVisits"); f.itinerary.update(now + 300, options);
    expect(f.itinerary.snapshots.find(snapshot => snapshot.actorId === actor.id)).toBeUndefined();
    expect(f.city.agents.find(item => item.id === actor.id)?.carrier).toBe("transport:test");
    expect(clear).not.toHaveBeenCalled();
    f.itinerary.clear(); expect(clear.mock.calls.every(([id]) => id !== actor.visit!.id)).toBe(true);
  });

  it("releases a timed out itinerary even when the resident is still waiting for a safe indoor exit", () => {
    const f = fixture(); let now = 0;
    for (; now < 5000; now += 100) { f.itinerary.update(now, options); if (f.itinerary.snapshots[0]?.arrived) break; f.city.advance(100); }
    const actorId = f.itinerary.snapshots[0]!.actorId;
    f.city.setWalkClosures(new Set(["0,0"]));
    for (let elapsed = 0; elapsed < 2000; elapsed += 100) f.city.advance(100);
    expect(f.city.agents.find(actor => actor.id === actorId)).toMatchObject({ activity: "INSIDE", visit: undefined });
    f.itinerary.update(now + 66_000, options);
    expect(f.itinerary.snapshots.find(snapshot => snapshot.actorId === actorId)).toBeUndefined();
    expect(f.itinerary.metrics.cancelled).toBeGreaterThan(0);
    expect(f.city.agents.find(actor => actor.id === actorId)?.activity).toBe("INSIDE");
  });

  it("skips genuinely unsafe optional stops and parks while completing the physical mandatory route", () => {
    const f = fixture(); f.itinerary.compile({ ...f.input, stops: [{ ...f.stop, queue: [{ x: 12, y: 0 }] }], parks: [{ taskId: "park", targets: [{ x: 12, y: 0 }] }] });
    const phases = new Set<string>();
    for (let now = 0; now <= 200_000 && !f.itinerary.metrics.completed; now += 100) {
      f.itinerary.update(now, options); for (const item of f.itinerary.snapshots) phases.add(item.phase); f.city.advance(100);
    }
    expect(f.itinerary.metrics.completed).toBeGreaterThan(0);
    expect(f.itinerary.metrics.skippedOptional).toBeGreaterThanOrEqual(2);
    expect([...phases]).not.toContain("STOP"); expect([...phases]).not.toContain("PARK");
  });

  it("creates no pretend residents or destinations when buildings are unfinished or entrances are outside walking cells", () => {
    const f = fixture(); const ids = f.city.agents.map(actor => actor.id);
    f.itinerary.compile({ ...f.input, tasks: f.input.tasks.map(task => ({ ...task, stage: 4 })) }); f.itinerary.update(0, options);
    expect(f.itinerary.snapshots).toEqual([]);
    f.itinerary.compile({ ...f.input, tasks: f.input.tasks.map(task => ({ ...task, accessPath: [{ x: 100, y: 100 }] })) }); f.itinerary.update(300, options);
    expect(f.itinerary.snapshots).toEqual([]); expect(f.city.agents.map(actor => actor.id)).toEqual(ids);
  });
});
