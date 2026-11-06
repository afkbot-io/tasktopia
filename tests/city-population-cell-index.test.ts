import { expect, it } from 'vitest';
import { populationCellIndexSteps } from '../src/client/city-population-cell-index';
import { completePreparation, prepareCooperatively } from '../src/shared/cooperative-preparation';

it('queries only bounded nearby spawn buckets after compiling a large sparse network', () => {
  const cells = [...Array.from({ length: 10_000 }, (_, i) => ({ x: 10_000 + i * 32, y: 0 })), { x: -1, y: -1 }];
  const index = completePreparation(populationCellIndexSteps(cells, () => true));
  cells[Symbol.iterator] = () => { throw new Error('full spawn graph scan'); };
  expect(index.query({ minX: -10, minY: -10, maxX: 10, maxY: 10 })).toEqual({ cells: [{ x: -1, y: -1 }], buckets: 4, visited: 1 });
  const huge = index.query({ minX: -1_000_000, minY: -1_000_000, maxX: 1_000_000, maxY: 1_000_000 });
  expect(huge.cells.length).toBeLessThanOrEqual(512);expect(huge.buckets).toBeLessThanOrEqual(256);expect(huge.visited).toBeLessThanOrEqual(2048);
});

it('prepares and cancels the spawn index cooperatively without publishing partial cells', async () => {
  const cells = Array.from({ length: 20_000 }, (_, x) => ({ x, y: 0 }));let turns = 0;
  const index = await prepareCooperatively(populationCellIndexSteps(cells, cell => cell.x % 2 === 0), { now: () => 0, yieldTask: async () => { turns++; } });
  expect(turns).toBeGreaterThan(1);expect(index.query({ minX: 0, minY: 0, maxX: 10, maxY: 10 }).cells.every(cell => cell.x % 2 === 0)).toBe(true);
  const abort = new AbortController();
  await expect(prepareCooperatively(populationCellIndexSteps(cells, () => true), { signal: abort.signal, now: () => 0,
    yieldTask: async () => { abort.abort(); } })).rejects.toMatchObject({ name: 'AbortError' });
});

it('retains safe samples in the far corner of a dense bucket and spreads a bounded query across visible blocks', () => {
  const cells = Array.from({ length: 128 }, (_, y) => Array.from({ length: 128 }, (_, x) => ({ x, y }))).flat();
  const index = completePreparation(populationCellIndexSteps(cells, () => true));
  expect(index.query({ minX: 12, minY: 12, maxX: 15, maxY: 15 }).cells.length).toBeGreaterThan(0);
  const query = index.query({ minX: 0, minY: 0, maxX: 127, maxY: 127 });
  const represented = new Set(query.cells.map(cell => `${Math.floor(cell.x / 16)},${Math.floor(cell.y / 16)}`));
  expect(represented.size).toBeGreaterThanOrEqual(50);
  expect(query.cells.length).toBeLessThanOrEqual(512);expect(query.visited).toBeLessThanOrEqual(2048);
});

it('finds offscreen approaches at every edge of a huge viewport without scanning its interior', () => {
  const cells = [{ x: 8, y: 5000 }, { x: 9992, y: 5000 }, { x: 5000, y: 8 }, { x: 5000, y: 9992 }];
  const index = completePreparation(populationCellIndexSteps(cells, () => true));
  const query = index.query({ minX: 0, minY: 0, maxX: 10_000, maxY: 10_000 }, { minX: 16, minY: 16, maxX: 9984, maxY: 9984 });
  expect(new Set(query.cells.map(cell => `${cell.x},${cell.y}`))).toEqual(new Set(cells.map(cell => `${cell.x},${cell.y}`)));
  expect(query.buckets).toBeLessThanOrEqual(256);expect(query.visited).toBe(4);
});
