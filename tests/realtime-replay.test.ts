import { afterEach, expect, it, vi } from 'vitest';
import type { RealtimeEvent } from '../src/shared/contracts';
import { RealtimeReplay } from '../src/client/realtime-replay';

const event = (id: number, countryId = 'country'): RealtimeEvent => ({ id, countryId, worldVersion: id, type: 'task.renamed', createdAt: '2026-10-16T00:00:00Z', payload: { taskId: 'task' } });
const controllers: RealtimeReplay[] = [];
afterEach(() => { for (const controller of controllers.splice(0)) controller.close(); vi.useRealTimers(); });

it('commits complete ordered history and live arrivals, allowing IDs from other countries between them', async () => {
  let cursor = 0;
  const applied: number[] = [];
  let page!: (events: RealtimeEvent[]) => void;
  const read = vi.fn().mockImplementationOnce(() => new Promise<RealtimeEvent[]>(resolve => { page = resolve; })).mockResolvedValueOnce([event(40)]);
  const replay = new RealtimeReplay({ countryId: 'country', cursor: () => cursor, pageSize: 2, read,
    apply: e => { if (e.id > cursor) { cursor = e.id; applied.push(e.id); } }, online: vi.fn() });
  controllers.push(replay);
  const opening = replay.connect();
  replay.receive(event(50)); replay.receive(event(20, 'foreign'));
  await Promise.resolve();
  page([event(10), event(30)]);
  await opening;
  expect(applied).toEqual([10, 30, 40, 50]);
  expect(cursor).toBe(50);
  replay.close();
});

it('bounds a hung history read and restores an authoritative cursor before draining newer history', async () => {
  vi.useFakeTimers();
  let cursor = 0;
  const applied: number[] = [];
  const resynchronize = vi.fn(async () => 200);
  const read = vi.fn(async (after: number) => after === 200 ? [event(210)] : await new Promise<RealtimeEvent[]>(() => undefined));
  const replay = new RealtimeReplay({ countryId: 'country', cursor: () => cursor, timeoutMs: 10, retryDelayMs: 2, read,
    apply: e => { cursor = e.id; applied.push(e.id); }, online: vi.fn(), resynchronize, commitCursor: value => { cursor = value; } });
  controllers.push(replay);
  const opening = replay.connect(); replay.receive(event(250));
  await vi.advanceTimersByTimeAsync(55);
  expect(resynchronize).toHaveBeenCalledTimes(1);
  await opening;
  expect(applied).toEqual([210, 250]);
  expect(cursor).toBe(250);
});

it('resynchronizes after live buffer overflow instead of retaining an unbounded arrival queue', async () => {
  vi.useFakeTimers();
  let cursor = 0;
  const resynchronize = vi.fn(async () => 100);
  const read = vi.fn(async (after: number) => after === 100 ? [] : await new Promise<RealtimeEvent[]>(() => undefined));
  const apply = vi.fn();
  const replay = new RealtimeReplay({ countryId: 'country', cursor: () => cursor, capacity: 2, timeoutMs: 10, retryDelayMs: 2, read,
    apply, online: vi.fn(), resynchronize, commitCursor: value => { cursor = value; } });
  controllers.push(replay);
  const opening = replay.connect();
  for (const id of [10, 30, 50, 70, 90]) replay.receive(event(id));
  await vi.advanceTimersByTimeAsync(55);
  expect(resynchronize).toHaveBeenCalledTimes(1);
  await opening;
  expect(cursor).toBe(100); expect(apply).not.toHaveBeenCalled();
});

it('does not endlessly retry unavailable history or advance its cursor when resynchronization also fails', async () => {
  vi.useFakeTimers();
  let cursor = 0;
  const read = vi.fn(async () => { throw new Error('offline'); });
  const resynchronize = vi.fn(async () => { throw new Error('offline'); });
  const replay = new RealtimeReplay({ countryId: 'country', cursor: () => cursor, timeoutMs: 10, retryDelayMs: 2, read,
    apply: e => { cursor = e.id; }, online: vi.fn(), resynchronize, commitCursor: value => { cursor = value; } });
  controllers.push(replay);
  const opening = replay.connect(); replay.receive(event(50));
  await vi.advanceTimersByTimeAsync(55);
  expect(resynchronize).toHaveBeenCalledTimes(1);
  expect(read.mock.calls.length).toBeLessThanOrEqual(3);
  await opening;
  expect(cursor).toBe(0);
});

it('cancels a disconnected read and ignores its late completion after another connection is ready', async () => {
  let cursor = 0;
  let finish!: (events: RealtimeEvent[]) => void;
  let signal!: AbortSignal;
  const read = vi.fn().mockImplementationOnce((_after, currentSignal) => { signal = currentSignal; return new Promise<RealtimeEvent[]>(resolve => { finish = resolve; }); }).mockResolvedValueOnce([event(20)]);
  const applied: number[] = [], online = vi.fn();
  const replay = new RealtimeReplay({ countryId: 'country', cursor: () => cursor, read,
    apply: e => { cursor = e.id; applied.push(e.id); }, online });
  controllers.push(replay);
  const first = replay.connect(); await Promise.resolve();
  replay.disconnect();
  expect(signal.aborted).toBe(true);
  await replay.connect();
  finish([event(10), event(30)]); await first;
  expect(applied).toEqual([20]);
  expect(cursor).toBe(20);
  expect(online.mock.calls.at(-1)).toEqual([true]);
});

it('rejects foreign history pages and uses recovery without applying their events', async () => {
  vi.useFakeTimers();
  let cursor = 0;
  const apply = vi.fn();
  const read = vi.fn(async (after: number) => after === 100 ? [] : [event(50, 'foreign')]);
  const replay = new RealtimeReplay({ countryId: 'country', cursor: () => cursor, read, apply, online: vi.fn(), retryDelayMs: 2,
    resynchronize: async () => 100, commitCursor: value => { cursor = value; } });
  controllers.push(replay);
  const opening = replay.connect(); await vi.advanceTimersByTimeAsync(10); await opening;
  expect(apply).not.toHaveBeenCalled(); expect(cursor).toBe(100);
});

it('never commits a live arrival past a failed history page; retries from the confirmed cursor', async () => {
  vi.useFakeTimers();
  let cursor = 0;
  const applied: number[] = [];
  let second!: () => void;
  const read = vi.fn().mockResolvedValueOnce([event(10), event(30)])
    .mockImplementationOnce(() => new Promise<RealtimeEvent[]>((_resolve, reject) => { second = () => reject(new Error('offline')); }))
    .mockResolvedValueOnce([event(10), event(30)]).mockResolvedValueOnce([event(40)]);
  const replay = new RealtimeReplay({ countryId: 'country', cursor: () => cursor, pageSize: 2, retryDelayMs: 10, read,
    apply: e => { if (e.id > cursor) { cursor = e.id; applied.push(e.id); } }, online: vi.fn() });
  controllers.push(replay);
  const opening = replay.connect();
  await vi.advanceTimersByTimeAsync(0);
  replay.receive(event(50)); second();
  await Promise.resolve(); await Promise.resolve();
  expect(cursor).toBe(0);
  expect(applied).toEqual([]);
  await vi.advanceTimersByTimeAsync(20);
  await opening;
  expect(applied).toEqual([10, 30, 40, 50]);
  expect(read.mock.calls[2]?.[0]).toBe(0);
  replay.close();
});
