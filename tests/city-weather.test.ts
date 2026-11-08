import { expect, it } from 'vitest';
import { createWetCellIndex, prepareWetCellIndexAsync, sampleCloudShadows, sampleRainStreaks } from '../src/client/city-weather';
import { cityLifeHash } from '../src/client/city-life';

const view = { minX: -20, minY: -15, maxX: 70, maxY: 60 };

it('keeps overlapping cloud and rain poses in world coordinates when the camera pans', () => {
  const pan = { minX: -18, minY: -13, maxX: 72, maxY: 62 };
  for (const sample of [sampleCloudShadows('city', 400_000, view, false).poses,
    sampleRainStreaks('shower', 400_000, view, false, 1).poses]) {
    const next = sample[0]!.id.startsWith('cloud:') ? sampleCloudShadows('city', 400_000, pan, false).poses
      : sampleRainStreaks('shower', 400_000, pan, false, 1).poses;
    const common = sample.filter(p => next.some(n => n.id === p.id));
    expect(common.length).toBeGreaterThan(1);
    for (const pose of common) expect(next.find(n => n.id === pose.id)).toEqual(pose);
  }
  const clouds = sampleCloudShadows('city', 400_000, view, false).poses;
  const later = sampleCloudShadows('city', 401_000, view, false).poses;
  const same = clouds.find(p => later.some(n => n.id === p.id))!;
  expect(later.find(p => p.id === same.id)!.x - same.x).toBe(3);
});

it('bounds weather work for huge negative-coordinate viewports and uses smaller economy budgets', () => {
  const huge = { minX: -100_000, minY: -100_000, maxX: 100_000, maxY: 100_000 };
  for (const economy of [false, true]) {
    const clouds = sampleCloudShadows('city', 10_000, huge, economy);
    const rain = sampleRainStreaks('shower', 10_000, huge, economy, 1);
    expect(clouds.poses.length).toBeLessThanOrEqual(economy ? 6 : 12);
    expect(clouds.visited).toBeLessThanOrEqual(576);
    expect(rain.poses.length).toBeLessThanOrEqual(economy ? 48 : 112);
    expect(rain.visited).toBeLessThanOrEqual(1024);
    expect(clouds.poses.every(p => Number.isFinite(p.x + p.y))).toBe(true);
  }
  expect(sampleRainStreaks('shower', 0, view, false, 0).poses).toEqual([]);
  expect(sampleCloudShadows('city', NaN, view, false).poses).toEqual([]);
});

it('queries local wet cells without revisiting ten thousand remote city samples or blocked cells', () => {
  const cells = new Map<string, { x: number; y: number }>();
  for (let i = 0; i < 110_000; i++) { const x = 10_000 + i * 40; cells.set(`${x},0`, { x, y: 0 }); }
  for (let x = -12; x <= 12; x++) for (let y = -12; y <= 12; y++) cells.set(`${x},${y}`, { x, y });
  const blocked = new Set([...cells.keys()].filter(id => cityLifeHash(id) % 11 === 0).slice(-4));
  const index = createWetCellIndex(cells, cells, blocked);
  expect(index.size).toBeGreaterThan(10_000);
  // Once compiled, neither source collection may be iterated by a frame query.
  cells[Symbol.iterator] = () => { throw new Error('full city scan'); };
  const result = index.query({ minX: -12, minY: -12, maxX: 12, maxY: 12 }, 28);
  expect(result.cells.length).toBeGreaterThan(0);
  expect(result.buckets).toBe(4);
  expect(result.visited).toBeLessThanOrEqual(96);
  expect(result.cells.length).toBeLessThanOrEqual(28);
  expect(result.cells.every(c => !blocked.has(`${c.x},${c.y}`) && Math.abs(c.x) <= 12)).toBe(true);
  expect(new Set(result.cells.map(c => `${c.x},${c.y}`)).size).toBe(result.cells.length);
});

it('prepares large wet geometry cooperatively and cancels without publishing a partial index', async () => {
  const cells = new Map(Array.from({ length: 30_000 }, (_, x) => [`${x},0`, { x, y: 0 }] as const));
  let turns = 0;
  const index = await prepareWetCellIndexAsync(cells, new Map(), new Set(), { now: () => 0, yieldTask: async () => { turns++; } });
  expect(turns).toBeGreaterThan(1);
  expect(index.query(view, 28)).toEqual(createWetCellIndex(cells, new Map(), new Set()).query(view, 28));
  const abort = new AbortController();
  await expect(prepareWetCellIndexAsync(cells, new Map(), new Set(), { signal: abort.signal, now: () => 0,
    yieldTask: async () => { abort.abort(); } })).rejects.toMatchObject({ name: 'AbortError' });
});
