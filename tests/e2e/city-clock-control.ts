import type { Page } from '@playwright/test';

/** Pause without a race between reading browser time and the public RPC. */
export async function pauseInstalledClock(page: Page): Promise<void> {
  const target = await page.evaluate(() => Date.now());
  // Fixed Date spans only the RPC; existing timers keep running until pauseAt.
  await page.clock.setFixedTime(target);
  try { await page.clock.pauseAt(target); }
  finally { await page.clock.setSystemTime(target); }
}
