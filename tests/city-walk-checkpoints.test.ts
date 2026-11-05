import { expect, it } from 'vitest';
import { buildCityWalkNetworkAsync, type CityWalkInput } from '../src/client/city-walk-network';
import { prepareCooperatively } from '../src/client/cooperative-preparation';

function terrainWork(size: number) {
  const terrain: CityWalkInput['terrain'] = Array.from({ length: size }, (_, x) => ({ x, y: 0, terrain: 'MEADOW' }));
  const iterator = terrain[Symbol.iterator].bind(terrain);let visited = 0;
  terrain[Symbol.iterator] = function* () { for (const cell of iterator()) { visited++;yield cell; }return undefined; };
  const input: CityWalkInput = { terrain, roads: new Map(), surfaces: [], tasks: [], features: [], decorations: [] };
  return { input, visited: () => visited };
}

it('bounds clock sampling overhead while retaining every real terrain cell', async () => {
  const f = terrainWork(1000);let clockReads = 0;
  const result = await buildCityWalkNetworkAsync(f.input, { now: () => { clockReads++;return 0; }, yieldTask: async () => {} });
  expect(result.animalGraph.size).toBe(1000);expect(f.visited()).toBe(1000);
  expect(clockReads).toBeLessThanOrEqual(250);
});

it.each([undefined, 8192])('keeps the raw-work fairness bound with requested limit %s under a frozen clock', async maxOperations => {
  const f = terrainWork(20_000), pauses: number[] = [];
  const result = await buildCityWalkNetworkAsync(f.input, { maxOperations, now: () => 0, yieldTask: async () => { pauses.push(f.visited()); } });
  expect(pauses.length).toBeGreaterThan(1);
  for (let i = 0; i < pauses.length; i++) expect(pauses[i]! - (pauses[i - 1] ?? 0)).toBeLessThanOrEqual(8192);
  expect(result.animalGraph.size).toBe(20_000);
});

it('cancels after at most one small batch at a held time boundary and rejects late publication', async () => {
  const f = terrainWork(1000), controller = new AbortController();let ticks = 0, release!: () => void, entered!: () => void, published = false;
  const enteredPause = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  const work = buildCityWalkNetworkAsync(f.input, { signal: controller.signal, budgetMs: 1, now: () => ticks++,
    yieldTask: () => { entered();return held; } }).then(result => { published = true;return result; });
  await enteredPause;const at = f.visited();expect(at).toBeGreaterThan(0);expect(at).toBeLessThanOrEqual(16);
  controller.abort();await expect(work).rejects.toMatchObject({ name: 'AbortError' });
  release();await Promise.resolve();expect(published).toBe(false);expect(f.visited()).toBe(at);
});

it.each([0, -1, NaN, Infinity, 1.5, 8193])('rejects invalid cooperative operation limit %s before advancing the generator', async maxOperations => {
  let advanced = 0;
  function* steps() { advanced++;yield;return 'complete'; }
  await expect(prepareCooperatively(steps(), { maxOperations })).rejects.toThrow(RangeError);
  expect(advanced).toBe(0);
});

it('honours a smaller explicit limit and retains the generator result', async () => {
  let progressed = 0;const pauses: number[] = [];
  function* steps() { for (let i = 0; i < 10; i++) { progressed++;yield; }return 'complete'; }
  expect(await prepareCooperatively(steps(), { maxOperations: 3, now: () => 0, yieldTask: async () => { pauses.push(progressed); } })).toBe('complete');
  expect(pauses).toEqual([3, 6, 9]);
});
