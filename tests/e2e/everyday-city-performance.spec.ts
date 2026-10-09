import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { everydayFixture } from './everyday-city-fixture';

test('everyday real-clock paired CPU and retained heap stay bounded after lifecycle changes', async ({ page, browserName }, info) => {
  test.skip(browserName !== 'chromium', 'CDP heap measurement requires Chromium'); test.setTimeout(120000);
  await page.setViewportSize({ width: 1440, height: 1100 }); const f = await everydayFixture(page);
  try {
    await f.focus(f.pendingSchool);
    await page.locator('.world-menu > summary').click();
    const prefs = page.locator('.world-preferences:visible'); await prefs.locator('> summary').click();
    await prefs.getByLabel('Детализация').selectOption('NORMAL');
    const enabled = prefs.getByLabel('Жизнь города');
    const samples: Record<string, unknown>[] = [];
    const sample = async (label: string) => {
      await page.waitForTimeout(2500);
      samples.push(await f.host.evaluate((el, label) => { const d = (el as HTMLElement).dataset;
        return { label, cpuP95: Number(d.livingWorldFrameCpuP95Ms), cpuMax: Number(d.livingWorldFrameCpuMaxMs),
          frameSamples: Number(d.livingWorldFrameSamples), planningMs: Math.max(Number(d.roadPlanningMs ?? 0), Number(d.everydayPlanningMs ?? 0)),
          cars: Number(d.cars), walkers: Number(d.walkers), stops: Number(d.transitStops), visitors: Number(d.everydayVisitors) };
      }, label));
    };
    await enabled.uncheck(); for (let i = 0; i < 3; i++) await sample(`baseline ${i}`);
    await enabled.check(); for (let i = 0; i < 3; i++) await sample(`everyday idle ${i}`);
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    await f.service.activateDistrict(f.user.countryId, f.pendingSchool.districtId, crypto.randomUUID());
    await f.call('task.set_status', { taskId: f.pendingSchool.id, status: 'COMPLETED' });
    await expect(f.host).toHaveAttribute('data-everyday-event', 'OPEN_SCHOOL', { timeout: 15000 });
    await sample('actual opening');
    const cdp = await page.context().newCDPSession(page); await cdp.send('HeapProfiler.collectGarbage');
    const before = await cdp.send('Runtime.getHeapUsage');
    for (let i = 0; i < 8; i++) {
      await page.emulateMedia({ reducedMotion: 'reduce' }); await expect(f.host).toHaveAttribute('data-everyday-event', '');
      await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.waitForTimeout(600);
    }
    await sample('after eight motion cancellation cycles');
    await cdp.send('HeapProfiler.collectGarbage'); const after = await cdp.send('Runtime.getHeapUsage');
    const renderer = await page.locator('.world-canvas canvas').evaluate(el => { const gl = (el as HTMLCanvasElement).getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info'); return ext ? gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unavailable'; });
    const report = { workload: 'Изолированный город: шесть школ/садиков, два парка, пять объектов стадии4; общая mobility, реальное время без page.clock. Парные3×2.5s окна off/on, одно открытие через MCP/WS, восемь отмен reduced-motion.',
      budgets: { livingCpuP95Ms: 8, rareRoadPlannerMs: 50, retainedHeapBytes: 8 * 1024 * 1024 }, renderer,
      samples, before, after, heapGrowth: after.usedSize - before.usedSize };
    await writeFile(info.outputPath('everyday-performance.json'), JSON.stringify(report, null, 2));
    expect(Math.max(...samples.map(s => Number(s.cpuP95)))).toBeLessThanOrEqual(8);
    expect(Math.max(...samples.map(s => Number(s.planningMs)))).toBeLessThanOrEqual(50);
    expect(samples.every(s => Number(s.frameSamples) === 120)).toBe(true);
    expect(after.usedSize - before.usedSize).toBeLessThan(8 * 1024 * 1024); await cdp.detach();
  } finally { await f.cleanup(); }
});
