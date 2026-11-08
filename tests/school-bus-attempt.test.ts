import { describe, expect, it } from 'vitest';
import { isSchoolBusAttemptTerminal, SCHOOL_BUS_OBSERVATION_WORLD_MS } from './school-bus-attempt';

const start = 100_000;
const before = { schoolBusArrived: '0', schoolBuses: '0', transitRole: '' };
const ended = { roadEventServerNow: String(start + 63_000), transitRole: '', schoolBusVisits: '0', schoolBusArrived: '0', schoolBuses: '1', schoolBusPendingTask: '' };
const terminal = (current = ended, observedSchoolBus = true) => isSchoolBusAttemptTerminal({ scheduledStartMs: start, before, current, observedSchoolBus });

describe('school bus attempt termination from published state', () => {
  it('сохраняет полное время пешего пути после поздней реальной высадки WebKit', () => {
    // Retained native v164: the bus alighted at +174742.989ms; at the
    // former +184s observer deadline a child still had a valid school visit.
    const enteredAt = 1794115358371.7942, alightedAt = 1794115533114.7834;
    const current = { roadEventServerNow: '1794115542431.5293', transitRole: '', schoolBusVisits: '1',
      schoolBusArrived: '0', schoolBuses: '1', schoolBusPendingTask: '' };
    expect(isSchoolBusAttemptTerminal({ scheduledStartMs: 1794115358000, before, current, observedSchoolBus: true })).toBe(false);
    expect(alightedAt + 60_000 - enteredAt).toBeLessThanOrEqual(SCHOOL_BUS_OBSERVATION_WORLD_MS);
  });
  it('сохраняет физические шаги для ожидающей заявки после завершения уличной сценки',()=>{
    expect(terminal({...ended,schoolBusPendingTask:'school'})).toBe(false);
    const missing:Partial<typeof ended>={...ended};delete missing.schoolBusPendingTask;
    expect(isSchoolBusAttemptTerminal({scheduledStartMs:start,before,current:missing,observedSchoolBus:true})).toBe(false);
  });
  it('recognizes an observed trip cancelled by a road response after the ceremony', () => {
    expect(terminal({ ...ended, transitRole: 'SCHOOL_BUS', roadEventServerNow: String(start + 58_507) })).toBe(false);
    expect(terminal()).toBe(true);
  });

  it('waits through empty boarding, travel and alighting before ending an empty trip', () => {
    for (const offset of [13_478, 36_000, 45_000]) {
      expect(terminal({ ...ended, transitRole: 'SCHOOL_BUS', roadEventServerNow: String(start + offset) })).toBe(false);
    }
    expect(terminal({ ...ended, roadEventServerNow: String(start + 49_493) })).toBe(true);
  });

  it('does not confuse an offscreen pose with an expired ceremony', () => {
    expect(terminal({ ...ended, roadEventServerNow: String(start + 43_999) })).toBe(false);
    expect(terminal({ ...ended, roadEventServerNow: String(start + 44_000) })).toBe(true);
  });

  it('preserves a late viable bus and children walking to the doorway', () => {
    expect(terminal({ ...ended, roadEventServerNow: String(start + 79_000), transitRole: 'SCHOOL_BUS' })).toBe(false);
    expect(terminal({ ...ended, schoolBusVisits: '1' })).toBe(false);
    expect(terminal({ ...ended, schoolBusArrived: '1' })).toBe(false);
  });

  it('requires positive evidence of a school bus in this attempt', () => {
    expect(terminal({ ...ended, schoolBuses: '0' }, false)).toBe(false);
    expect(terminal(ended, false)).toBe(true);
    expect(isSchoolBusAttemptTerminal({ scheduledStartMs: start, before: { ...before, transitRole: 'SCHOOL_BUS', schoolBuses: '1' }, current: ended, observedSchoolBus: false })).toBe(true);
  });

  it('allows a later ordinary bus without waiting for a vanished school trip', () => {
    expect(terminal({ ...ended, transitRole: 'BUS' })).toBe(true);
  });

  it.each([
    { roadEventServerNow: '' }, { roadEventServerNow: 'NaN' }, { roadEventServerNow: 'Infinity' },
    { transitRole: 'UNKNOWN' }, { schoolBusVisits: '' }, { schoolBusVisits: '-1' }, { schoolBusVisits: '0.5' },
    { schoolBusArrived: '' }, { schoolBusArrived: 'true' }, { schoolBusArrived: '-1' }, { schoolBuses: '' }, { schoolBuses: '0.5' },
  ])('keeps waiting when telemetry cannot prove termination: %j', invalid => {
    expect(terminal({ ...ended, ...invalid })).toBe(false);
  });

  it('rejects a missing metric, a counter reset and an invalid scheduled start', () => {
    const incomplete: Partial<typeof ended> = { ...ended };
    delete incomplete.schoolBusVisits;
    expect(isSchoolBusAttemptTerminal({ scheduledStartMs: start, before, current: incomplete, observedSchoolBus: true })).toBe(false);
    expect(isSchoolBusAttemptTerminal({ scheduledStartMs: start, before: { ...before, schoolBusArrived: '2' }, current: ended, observedSchoolBus: true })).toBe(false);
    expect(isSchoolBusAttemptTerminal({ scheduledStartMs: start, before: { ...before, schoolBuses: '2' }, current: ended, observedSchoolBus: true })).toBe(false);
    expect(isSchoolBusAttemptTerminal({ scheduledStartMs: NaN, before, current: ended, observedSchoolBus: true })).toBe(false);
  });
});
