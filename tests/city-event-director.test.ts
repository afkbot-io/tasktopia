import { expect, it } from 'vitest';
import { CityEventDirector, type CityEventLease } from '../src/client/city-event-director';

const options = { enabled: true, economy: false, busy: new Set<string>() };
const lease = (id: string, extra: Partial<CityEventLease> = {}): CityEventLease => ({ id, channel: 'EVERYDAY',
  priority: 1, cells: [{ x: 1, y: 1 }], actors: [], until: 70_000, replayUntil: 180_000, onRelease: () => {}, ...extra });

it('admits late opening after a short grace and bounds failed attempts without replaying accepted IDs', () => {
  const director = new CityEventDirector(); director.update(42_000, options);
  expect(director.due('EVERYDAY', 42_000, 8000)).toBe(false);
  expect(director.due('EVERYDAY', 43_200, 8000)).toBe(true);
  expect(director.due('EVERYDAY', 43_201, 8000)).toBe(false);
  expect(director.due('EVERYDAY', 45_200, 8000)).toBe(true);
  expect(director.acquire(lease('city:0:school'))).toBe(true);
  expect(director.due('EVERYDAY', 50_000, 8000)).toBe(false);
  director.release('city:0:school');
  expect(director.acquire(lease('city:0:school'))).toBe(false);
  expect(director.metrics.attempts).toBe(2);
  director.update(82_000, options);
  expect(director.due('EVERYDAY', 82_000, 83_000)).toBe(false);
});

it('owns cells and actors exclusively and preempts only lower priorities with owner-scoped cleanup', () => {
  const director = new CityEventDirector(), ended: string[] = []; director.update(10_000, options);
  expect(director.acquire(lease('courtyard', { actors: ['resident'], onRelease: reason => ended.push(`courtyard:${reason}`) }))).toBe(true);
  expect(director.acquire(lease('park', { channel: 'NEIGHBOURHOOD', cells: [{ x: 5, y: 5 }], actors: ['resident'] }))).toBe(false);
  expect(director.acquire(lease('road', { channel: 'ROAD', priority: 3, onRelease: reason => ended.push(`road:${reason}`) }))).toBe(true);
  expect(ended).toEqual(['courtyard:PREEMPTED']);
  director.release('courtyard');expect(director.active.map(p => p.id)).toEqual(['road']);
  director.update(10_001, { ...options, busy: new Set(['1,1']) });
  expect(ended).toEqual(['courtyard:PREEMPTED', 'road:PROTECTED']);expect(director.active).toEqual([]);
  expect(director.acquire(lease('blocked', { channel: 'ROAD', priority: 3 }))).toBe(false);
});

it('trims bounded concurrent scenes and releases every expiry/disabled owner exactly once', () => {
  const director = new CityEventDirector(), ended: string[] = []; director.update(10_000, options);
  for (const [index, channel] of (['ROAD', 'EVERYDAY', 'NEIGHBOURHOOD'] as const).entries())
    expect(director.acquire(lease(channel, { channel, priority: 3 - index, cells: [{ x: index, y: 0 }],
      onRelease: () => ended.push(channel) }))).toBe(true);
  director.update(10_001, { ...options, economy: true });
  expect(director.active.map(p => p.id)).toEqual(['ROAD', 'EVERYDAY']);expect(ended).toEqual(['NEIGHBOURHOOD']);
  director.update(70_000, options);expect(ended.sort()).toEqual(['EVERYDAY', 'NEIGHBOURHOOD', 'ROAD']);
  director.update(70_001, { ...options, enabled: false });director.clear();expect(ended).toHaveLength(3);
  expect(director.due('ROAD', 90_000, 12_000)).toBe(false);
});

it('retries an unconfirmed service dispatch but never replays its confirmed episode', () => {
  const director = new CityEventDirector();director.update(10_000, options);
  const call = lease('pending-service', { channel: 'ROAD', provisional: true });
  expect(director.acquire(call)).toBe(true);director.release(call.id);
  expect(director.acquire(call)).toBe(true);
  expect(director.claimActors(call.id, ['engine'])).toBe(true);director.release(call.id);
  expect(director.acquire(call)).toBe(false);
});

it('protects only current scene actors and never exposes the internal ownership set', () => {
  const director = new CityEventDirector(); director.update(10_000, options);
  expect(director.acquire(lease('visit', { actors: ['resident'] }))).toBe(true);
  expect(director.protectedActorIds).toEqual(new Set(['resident']));
  (director.protectedActorIds as Set<string>).clear();
  expect(director.protectedActorIds.has('resident')).toBe(true);
  director.release('visit');expect(director.protectedActorIds.size).toBe(0);
});
