import { test, expect, type Page } from '@playwright/test';
import { setTimeout as nodeDelay } from 'node:timers/promises';
import { pauseInstalledClock } from './city-clock-control';

type ClockWindow = Window & { qaClockProbe: { fired: number; firedDate: number | null; firedTicks: number | null } };

test('public clock setup survives a delayed pause RPC and preserves a fresh timeout', async ({ page }, info) => {
  await page.clock.install({ time: new Date('2030-01-01T00:00:00.000Z') });
  const clock = page.clock, original = clock.pauseAt, descriptor = Object.getOwnPropertyDescriptor(clock, 'pauseAt');
  const notes: Array<Record<string, unknown>> = [];
  let delayedCalls = 0;
  const delayedPause: typeof clock.pauseAt = async function (this: Page['clock'], time) {
    delayedCalls++;
    await nodeDelay(250);
    const beforeDelegate = await page.evaluate(() => ({ date: Date.now(), ticks: performance.now() }));
    notes.push({ phase: 'before-real-pause-delegate', argument: time, ...beforeDelegate });
    return original.call(this, time);
  };
  clock.pauseAt = delayedPause;
  try {
    // The OLD Date.now()+100 helper must fail through the real public Clock API.
    await pauseInstalledClock(page);
    expect(delayedCalls).toBe(1);
    const paused = await page.evaluate(() => ({ date: Date.now(), ticks: performance.now() }));
    await nodeDelay(250);
    const stillPaused = await page.evaluate(() => ({ date: Date.now(), ticks: performance.now() }));
    expect(stillPaused).toEqual(paused);
    notes.push({ phase: 'paused-real-wait', paused, stillPaused });
    const start = await page.evaluate(() => {
      const target = window as unknown as ClockWindow;
      target.qaClockProbe = { fired: 0, firedDate: null, firedTicks: null };
      setTimeout(() => { target.qaClockProbe.fired++; target.qaClockProbe.firedDate = Date.now(); target.qaClockProbe.firedTicks = performance.now(); }, 20_000);
      return { date: Date.now(), ticks: performance.now() };
    });
    await clock.fastForward(19_999);
    const beforeDeadline = await page.evaluate(() => ({ ...(window as unknown as ClockWindow).qaClockProbe, date: Date.now(), ticks: performance.now() }));
    expect(beforeDeadline.fired).toBe(0);
    expect(beforeDeadline.date - start.date).toBe(19_999);
    expect(beforeDeadline.ticks - start.ticks).toBe(19_999);
    await clock.fastForward(1);
    const atDeadline = await page.evaluate(() => ({ ...(window as unknown as ClockWindow).qaClockProbe, date: Date.now(), ticks: performance.now() }));
    expect(atDeadline.fired).toBe(1);
    expect(atDeadline.firedDate).toBe(start.date + 20_000);
    expect(atDeadline.firedTicks).toBe(start.ticks + 20_000);
    expect(atDeadline.date - start.date).toBe(20_000);
    expect(atDeadline.ticks - start.ticks).toBe(20_000);
    notes.push({ phase: 'fresh-timer-boundary', start, beforeDeadline, atDeadline });
    await clock.resume();
    await nodeDelay(250);
    const resumed = await page.evaluate(() => ({ date: Date.now(), ticks: performance.now() }));
    expect(resumed.date).toBeGreaterThan(atDeadline.date);
    expect(resumed.ticks).toBeGreaterThan(atDeadline.ticks);
    notes.push({ phase: 'resumed-real-wait', resumed });
  } finally {
    if (clock.pauseAt === delayedPause) {
      if (descriptor) Object.defineProperty(clock, 'pauseAt', descriptor);
      else Reflect.deleteProperty(clock, 'pauseAt');
    }
    await clock.resume().catch(() => undefined);
    await info.attach('public-clock-rpc-boundary', { body: JSON.stringify({ delayedCalls, notes }), contentType: 'application/json' });
  }
});
