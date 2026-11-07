import { expect, it, vi } from 'vitest';
import { compileTransitLines } from '../src/client/city-transit-lines';
import type { TransitStop } from '../src/client/city-everyday-life';
import type { Cell } from '../src/shared/contracts';

const stop = (id: string, x: number, y: number): TransitStop => ({ id, lane: { x, y }, shelter: [], queue: [], route: [], direction: 'horizontal' });

it('builds a stable directed loop longer than64 cells from individually reachable legs', () => {
  const stops = [stop('a', 0, 0), stop('b', 40, 0), stop('c', 80, 0), stop('d', 80, 40), stop('e', 40, 40), stop('f', 0, 40)];
  const edge = (a: Cell, b: Cell) => stops.some((s, i) => s.lane === a && stops[(i + 1) % stops.length]!.lane === b);
  const lines = compileTransitLines(stops, edge);
  expect(lines).toHaveLength(1); expect(lines[0]!.stops.map(s => s.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  expect(compileTransitLines([...stops].reverse(), edge)).toEqual(lines);
  expect(lines[0]!.id).toBe(compileTransitLines([...stops, stop('unrelated', 900, 900)], edge)[0]!.id);
});

it('rejects one-way dead ends and does not invent a reverse path', () => {
  const stops = [stop('a', 0, 0), stop('b', 20, 0)];
  expect(compileTransitLines(stops, (a, b) => a.x < b.x)).toEqual([]);
  const [line] = compileTransitLines(stops, () => true);
  expect(line!.stops.map(s => s.id)).toEqual(['a', 'b']);
});

it('bounds reachability work locally and never queries far-away stop pairs', () => {
  const stops = Array.from({ length: 1000 }, (_, i) => stop(`stop-${i}`, i * 100, 0));
  const edge = vi.fn(() => true);
  expect(compileTransitLines(stops, edge)).toEqual([]); expect(edge).not.toHaveBeenCalled();
});
