import { expect, it } from 'vitest';
import { CityEventDirector, type CityEventLease } from '../src/client/city-event-director';
import { neighbourhoodAdmissionDeadline } from './neighbourhood-admission';

it('даёт прежние 12 секунд свободного мира без блокирующего владельца', () => {
  expect(neighbourhoodAdmissionDeadline(100_000)).toBe(112_000);
  expect(neighbourhoodAdmissionDeadline(100_000, 99_000)).toBe(112_000);
});

it('продолжает кадры через сохранённый BIRDS lease Firefox и оставляет прежние 12 секунд на допуск', () => {
  // CI574 retained this now/until pair after90 browser advances of500ms.
  // The controlled start below is45s earlier; the trace did not record its
  // initial public world clock. This is not a replay of that exact journey.
  const observedAt = 2051222493514.5, until = 2051222493738.5;
  const startedAt = observedAt - 45_000, director = new CityEventDirector();
  const options = { enabled: true, economy: false, busy: new Set<string>() };
  director.update(until - 44_000, options);
  const birds: CityEventLease = { id: 'retained-ci574-birds', channel: 'EVERYDAY', priority: 2,
    cells: [{ x: 1, y: 1 }], actors: [], until, replayUntil: until + 1, onRelease: () => {} };
  expect(director.acquire(birds)).toBe(true);
  const neighbourhood: CityEventLease = { ...birds, id: 'native-home', channel: 'NEIGHBOURHOOD', priority: 1,
    until: until + 75_000, replayUntil: until + 180_000 };
  director.update(observedAt, options);
  expect(director.canAcquire(neighbourhood)).toBe(false);
  const deadline = neighbourhoodAdmissionDeadline(startedAt, until);
  expect(deadline).toBeGreaterThanOrEqual(until + 12_000);
  director.update(until, options);
  expect(director.canAcquire(neighbourhood)).toBe(true);
});

it('ограничивает новых владельцев единым пределом и отвергает неизвестные часы', () => {
  const startedAt = 100_000;
  expect(neighbourhoodAdmissionDeadline(startedAt, 500_000)).toBe(158_000);
  expect(() => neighbourhoodAdmissionDeadline(NaN)).toThrow();
  expect(() => neighbourhoodAdmissionDeadline(startedAt, Infinity)).toThrow();
});
