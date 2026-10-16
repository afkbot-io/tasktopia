import { afterEach, expect, it, vi } from 'vitest';
import type { RealtimeEvent } from '../src/shared/contracts';
import { clearTaskReadCaches, invalidateTaskReadCaches, loadTaskCard, loadTaskCollection, loadTaskDocument } from '../src/client/task-read-cache';
import { readTaskWithInvalidationRetry } from '../src/client/owned-read-cache';
import { taskEventRefreshesDependencies } from '../src/client/task-read-invalidation';

afterEach(() => { clearTaskReadCaches(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const card = { kind: 'task.card', version: 1, countryId: 'country', id: 'task', documentMetadata: [], counts: {} };
const event = (type: string, payload = {}): RealtimeEvent => ({ countryId: 'country', id: 1, worldVersion: 1, createdAt: '2026-10-16', type, payload: { taskId: 'task', ...payload } });
const page = { kind: 'task.collection-page', version: 1, countryId: 'country', taskId: 'task', collection: 'comments', items: [], nextCursor: null };

it('shares a scoped lightweight card without requesting full task history', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => new Response(JSON.stringify(card))); vi.stubGlobal('fetch', fetch);
  const values = await Promise.all([loadTaskCard('country', 'task'), loadTaskCard('country', 'task')]);
  expect(values[0]).toBe(values[1]); expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]![0]).toBe('/api/tasks/task/card?countryId=country');
});

it('rejects a response from another country and does not cache it', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ...card, countryId: 'foreign' })))
    .mockResolvedValueOnce(new Response(JSON.stringify(card))); vi.stubGlobal('fetch', fetch);
  await expect(loadTaskCard('country', 'task')).rejects.toThrow('несовместимую');
  expect((await loadTaskCard('country', 'task')).countryId).toBe('country'); expect(fetch).toHaveBeenCalledTimes(2);
});

it('bounds a stalled card request and aborts its underlying transport', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() => new Promise<Response>(() => undefined)); vi.stubGlobal('fetch', fetch);
  const read = loadTaskCard('country', 'task'); const rejected = expect(read).rejects.toThrow('Повторите');
  await vi.advanceTimersByTimeAsync(15_001); await rejected;
  expect(fetch.mock.calls[0]![1]?.signal?.aborted).toBe(true);
});

it('cancels an invalidated pending collection so its old page cannot revive', async () => {
  const fetch = vi.fn(() => new Promise<Response>(() => undefined)); vi.stubGlobal('fetch', fetch);
  const first = loadTaskCollection('country', 'task', 'comments');
  const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  await Promise.resolve(); invalidateTaskReadCaches(event('task.comment_added')); await rejected;
  fetch.mockResolvedValue(new Response(JSON.stringify(page)));
  expect((await loadTaskCollection('country', 'task', 'comments')).items).toEqual([]);
});

it('preserves unchanged document content when a comment refreshes the card', async () => {
  const doc = { id: 'doc', taskId: 'task', content: 'Material' };
  const fetch = vi.fn(async () => new Response(JSON.stringify(doc))); vi.stubGlobal('fetch', fetch);
  const first = await loadTaskDocument('country', 'task', 'doc');
  invalidateTaskReadCaches(event('task.comment_added'));
  expect(await loadTaskDocument('country', 'task', 'doc')).toBe(first);
  invalidateTaskReadCaches(event('task.fields_updated', { changedFields: ['documents'] }));
  await loadTaskDocument('country', 'task', 'doc'); expect(fetch).toHaveBeenCalledTimes(2);
});

it('lets one card subscriber leave without cancelling the other subscriber', async () => {
  let finish!: (response: Response) => void;
  const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise(resolve => { finish = resolve; })); vi.stubGlobal('fetch', fetch);
  const first = new AbortController(), second = new AbortController(); let firstError: unknown;
  const one = loadTaskCard('country', 'task', first.signal).catch(error => { firstError = error; });
  const two = loadTaskCard('country', 'task', second.signal);
  await Promise.resolve(); first.abort(); await Promise.resolve(); await Promise.resolve();
  expect(firstError).toMatchObject({ name: 'AbortError' });
  expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
  finish(new Response(JSON.stringify(card))); await one; expect(await two).toMatchObject(card);
  expect(await loadTaskCard('country', 'task')).toMatchObject(card); expect(fetch).toHaveBeenCalledTimes(1);
});

it('aborts the last document owner immediately and fences a late reply from a reopened document', async () => {
  const finishes: ((response: Response) => void)[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise(resolve => { finishes.push(resolve); })); vi.stubGlobal('fetch', fetch);
  const owner = new AbortController(); const old = loadTaskDocument('country', 'task', 'doc', owner.signal).catch(error => error);
  await Promise.resolve(); owner.abort(); expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  const reopened = loadTaskDocument('country', 'task', 'doc'); await Promise.resolve();
  expect(fetch).toHaveBeenCalledTimes(2);
  finishes[0]!(new Response(JSON.stringify({ id: 'doc', taskId: 'task', content: 'OLD' })));
  finishes[1]!(new Response(JSON.stringify({ id: 'doc', taskId: 'task', content: 'NEW' })));
  expect(await old).toMatchObject({ name: 'AbortError' }); expect((await reopened).content).toBe('NEW');
  expect((await loadTaskDocument('country', 'task', 'doc')).content).toBe('NEW');
});

it('rejects an already cancelled owner even when its card is cached', async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify(card))); vi.stubGlobal('fetch', fetch);
  await loadTaskCard('country', 'task'); const owner = new AbortController(); owner.abort();
  await expect(loadTaskCard('country', 'task', owner.signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(fetch).toHaveBeenCalledTimes(1);
});

it.each(['card', 'page', 'document'] as const)('bounds pending %s work and immediately reuses a released slot', async kind => {
  const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise(() => undefined)); vi.stubGlobal('fetch', fetch);
  const limit = kind === 'page' ? 12 : 4;
  const load = (index: number, signal?: AbortSignal) => kind === 'card' ? loadTaskCard('country', `task-${index}`, signal)
    : kind === 'document' ? loadTaskDocument('country', 'task', `doc-${index}`, signal) : loadTaskCollection('country', `task-${index}`, 'comments', null, signal);
  const owners = Array.from({ length: limit }, () => new AbortController());
  const reads = owners.map((owner, index) => load(index, owner.signal).catch(error => error));
  await Promise.resolve(); await expect(load(limit)).rejects.toThrow('Слишком много'); expect(fetch).toHaveBeenCalledTimes(limit);
  owners[0]!.abort(); const replacement = load(limit + 1).catch(error => error); await Promise.resolve(); expect(fetch).toHaveBeenCalledTimes(limit + 1);
  clearTaskReadCaches(); await Promise.all([...reads, replacement]);
});

it('invalidates only retained dependency pages that contain the changed target', async () => {
  const calls: string[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async url => {
    const taskId = String(url).includes('/task-a/') ? 'task-a' : 'task-c'; calls.push(taskId);
    return new Response(JSON.stringify({ ...page, taskId, collection: 'dependencies', items: [{ id: taskId === 'task-a' ? 'target' : 'unrelated', taskNumber: 1, title: 'Target', status: 'PLANNING' }] }));
  }); vi.stubGlobal('fetch', fetch);
  await loadTaskCollection('country', 'task-a', 'dependencies'); await loadTaskCollection('country', 'task-c', 'dependencies');
  invalidateTaskReadCaches(event('task.renamed', { taskId: 'target' }));
  await loadTaskCollection('country', 'task-a', 'dependencies'); await loadTaskCollection('country', 'task-c', 'dependencies');
  expect(calls).toEqual(['task-a', 'task-c', 'task-a']);
});

it('retries a shared invalidation abort before React publishes the next revision', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementationOnce(() => new Promise(() => undefined))
    .mockResolvedValueOnce(new Response(JSON.stringify(card))); vi.stubGlobal('fetch', fetch);
  const owner = new AbortController();
  const read = readTaskWithInvalidationRetry(owner.signal, () => loadTaskCard('country', 'task', owner.signal));
  await Promise.resolve(); invalidateTaskReadCaches(event('task.comment_added'));
  expect(await read).toMatchObject(card); expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
});

it('shows a recoverable error instead of retrying an aborting transport forever', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new DOMException('Transport stopped', 'AbortError')); vi.stubGlobal('fetch', fetch);
  const owner = new AbortController();
  await expect(readTaskWithInvalidationRetry(owner.signal, () => loadTaskDocument('country', 'task', 'doc', owner.signal))).rejects.toThrow('Повторите');
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('does not retry when the consumer leaves, including before transport startup', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise(() => undefined)); vi.stubGlobal('fetch', fetch);
  const owner = new AbortController();
  const read = readTaskWithInvalidationRetry(owner.signal, () => loadTaskCard('country', 'task', owner.signal));
  const result = expect(read).rejects.toMatchObject({ name: 'AbortError' }); owner.abort(); await result;
  expect(fetch).not.toHaveBeenCalled();
});

it('does not restart old private reads after the whole session cache is cleared', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementationOnce(() => new Promise(() => undefined))
    .mockResolvedValueOnce(new Response(JSON.stringify(card))); vi.stubGlobal('fetch', fetch);
  const owner = new AbortController();
  const result = readTaskWithInvalidationRetry(owner.signal, () => loadTaskCard('country', 'task', owner.signal)).catch(error => error);
  await Promise.resolve(); clearTaskReadCaches();
  expect(await result).toBeInstanceOf(Error); expect(fetch).toHaveBeenCalledTimes(1);
});

it.each(['task.renamed', 'task.status_changed', 'task.deleted', 'task.fields_updated'])('declares %s as a dependent-view refresh even when another task is selected', type => {
  expect(taskEventRefreshesDependencies(event(type))).toBe(true);
  expect(taskEventRefreshesDependencies(event('task.comment_added'))).toBe(false);
  expect(taskEventRefreshesDependencies(event('task.fields_updated', { changedFields: ['documents'] }))).toBe(false);
});

it('invalidates unknown in-flight dependency pages and permits immediate new reads after a legacy fields event', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementationOnce(() => new Promise(() => undefined))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ...page, taskId: 'a', collection: 'dependencies' }))); vi.stubGlobal('fetch', fetch);
  const pending = loadTaskCollection('country', 'a', 'dependencies').catch(error => error);
  await Promise.resolve(); invalidateTaskReadCaches(event('task.fields_updated', { taskId: 'b' }));
  expect(await pending).toMatchObject({ name: 'AbortError' });
  expect((await loadTaskCollection('country', 'a', 'dependencies')).items).toEqual([]); expect(fetch).toHaveBeenCalledTimes(2);
});
