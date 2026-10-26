import { expect, it } from 'vitest';
import { ServerWorldClock } from '../src/client/server-world-clock';
import { sceneClockStepTowardStart } from './scene-clock-step';

const retained = {
  before: 1793028122453.6233,
  target: 1793028456000,
  start: 1793028458000,
  ticks: 333546.3767089844,
  after: 1793028471897.5,
};

function synchronizedClock(initial: number, correction: number) {
  const clock = new ServerWorldClock();
  expect(clock.synchronize(initial, 0, 0)).toBe(true);
  expect(clock.synchronize(initial + correction, 0, 0)).toBe(true);
  return clock;
}

function fourAdvances(clock: ServerWorldClock, target: number, step: (now: number, target: number) => number) {
  let monotonic = 0;
  const samples: Array<{ before: number; ticks: number; after: number }> = [];
  for (let i = 0; i < 4; i++) {
    const before = clock.now(monotonic)!;
    if (before >= target) break;
    const ticks = step(before, target);
    monotonic += ticks + 100; // The original caller's runFor(100), unchanged.
    samples.push({ before, ticks, after: clock.now(monotonic)! });
  }
  return { now: clock.now(monotonic)!, samples };
}

it('keeps school preparation before start where the retained direct jump overshot it', () => {
  // This public resync is one valid witness of the retained net correction.
  // The trace did not retain CI's synchronization history or targetOffset.
  const correction = retained.after - (retained.before + retained.ticks + 100);
  expect(correction).toBeCloseTo(15797.5, 2);
  const old = fourAdvances(synchronizedClock(retained.before, correction), retained.target,
    (now, target) => Math.max(50, target - now));
  expect(old.samples).toHaveLength(1);
  expect(old.samples[0]!.ticks).toBe(retained.ticks);
  expect(old.now).toBeCloseTo(retained.after, 2);
  expect(old.now - retained.start).toBeCloseTo(13897.5, 2);

  const target = retained.start - 7000;
  const prepared = fourAdvances(synchronizedClock(retained.before, correction), target, sceneClockStepTowardStart);
  expect(prepared.samples.length).toBeLessThanOrEqual(4);
  expect(prepared.samples.every(sample => sample.after < retained.start)).toBe(true);
  expect(Math.abs(prepared.now - target)).toBeLessThanOrEqual(410);
});

it('bounds school preparation across the full six-kind gap and both intended slew limits', () => {
  const actualPreparationGap = retained.start - 7000 - retained.before;
  for (const gap of [actualPreparationGap, 330_000, 375_000, 450_000]) {
    for (const correction of [-90_000, 0, 90_000]) {
      const target = retained.before + gap, start = target + 7000;
      const result = fourAdvances(synchronizedClock(retained.before, correction), target, sceneClockStepTowardStart);
      const context = JSON.stringify({ gap, correction, ...result });
      expect(result.samples.length, context).toBeGreaterThan(0);
      expect(result.samples.length, context).toBeLessThanOrEqual(4);
      expect(result.samples.every(sample => sample.after < start), context).toBe(true);
      expect(Math.abs(result.now - target), context).toBeLessThanOrEqual(410);
    }
  }
});
