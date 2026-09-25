import { expect, test } from '@playwright/test';

test('близкая планета: ограниченная стоимость кадров при перемещении', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.request.post('/api/auth/login', { data: { email: 'demo@tasktopia.local', password: 'tasktopia-demo' } });
  await page.goto('/');
  const planet = page.locator('.planet-atlas');
  await expect(planet).toHaveAttribute('data-planet-ready', 'true');
  await page.locator('.planet-city-targets [data-city-id]').first().click();
  await expect(planet).toHaveAttribute('data-globe-zoom', '3.00');
  await page.screenshot({ path: testInfo.outputPath('compact-cities.png') });
  const miniatureBounds = await page.locator('.planet-country').evaluateAll(countries => countries.map(country => {
    const houses = [...country.querySelectorAll<SVGGElement>('[data-miniature-module]')];
    return houses.map(house => ({ width: house.getBoundingClientRect().width, height: house.getBoundingClientRect().height }));
  }).flat());
  expect(miniatureBounds.length).toBeGreaterThan(2);
  expect(miniatureBounds.every(box => box.width < 35 && box.height < 40)).toBe(true);
  // Zoom over the ocean so profiling cannot enter a city.
  await planet.locator(':scope > svg').dispatchEvent('wheel', { deltaY: -1600, clientX: 15, clientY: 1000, bubbles: true });
  await expect(planet).toHaveAttribute('data-globe-zoom', '8.50');
  const result = await planet.evaluate(async node => {
    const svg = node.querySelector('svg')!;
    const frames: number[] = [];
    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      svg.dispatchEvent(new KeyboardEvent('keydown', { key: i % 2 ? 'ArrowLeft' : 'ArrowRight', bubbles: true }));
      await new Promise(requestAnimationFrame);
      if (i >= 10) frames.push(performance.now() - start);
    }
    frames.sort((a, b) => a - b);
    return { median: frames[Math.floor(frames.length * .5)], p95: frames[Math.floor(frames.length * .95)], max: frames.at(-1), frames: frames.length };
  });
  console.log('PLANET_PAN_PROFILE', JSON.stringify(result));
  await testInfo.attach('planet-pan-profile', { body: JSON.stringify(result), contentType: 'application/json' });
  expect(result.p95!).toBeLessThan(100);
});
