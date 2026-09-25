import { expect, test } from '@playwright/test';
import { openMapCity } from './map-navigation';
import type { CitySceneDto } from '../../src/shared/city-scene-contract';

for (const uniform of [true, false]) test(`трава на границе города: ${uniform ? 'проверка цвета' : 'родные текстуры'}`,  async ({ page }, info) => {
  // A uniform authored material isolates compositing from texture variation.
  if (uniform) await page.route('**/atlas/terrain-v4/city/{grass,meadow}.png', async route => {
    const response = await route.fetch();
    const png = await response.body();
    const encoded = await page.evaluate(({ width, height }) => {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#8cb450'; context.fillRect(0, 0, width, height);
      return canvas.toDataURL().split(',')[1]!;
    }, { width: png.readUInt32BE(16), height: png.readUInt32BE(20) });
    await route.fulfill({ response, body: Buffer.from(encoded, 'base64') });
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.request.post('/api/auth/login', { data: { email: 'demo@tasktopia.local', password: 'tasktopia-demo' } });
  const loaded = page.waitForResponse(response => response.url().endsWith('/scene') && response.ok());
  await page.goto('/');
  await openMapCity(page);
  const scene = await (await loaded).json() as CitySceneDto;
  const host = page.locator('.world-canvas');
  await expect(host).toHaveAttribute('data-city-scene-commit', 'atomic', { timeout: 30000 });
  await expect(page.locator('.map-level-transition')).toHaveCount(0);
  const canvas = page.locator("canvas[aria-label='Интерактивная карта города']");
  const box = (await canvas.boundingBox())!;
  for (let i = 0; i < 8; i++) {
    const view = await host.evaluate(node => ({ x: Number(node.getAttribute('data-camera-world-x')), scale: Number(node.getAttribute('data-render-scale')) }));
    const dx = Math.max(-box.width * .35, Math.min(box.width * .35, (view.x - scene.city.bounds.minX) * 8 * view.scale));
    if (Math.abs(dx) < 2) break;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2, { steps: 4 }); await page.mouse.up();
  }
  await expect(host).toHaveAttribute('data-map-active', 'true');
  await expect(host).toHaveAttribute('data-camera-padding-visible-untextured', '0');
  await expect(host).toHaveAttribute('data-ground-bake-queue', '0');
  const camera = await host.evaluate(node => ({ x: Number(node.getAttribute('data-camera-world-x')), y: Number(node.getAttribute('data-camera-world-y')), scale: Number(node.getAttribute('data-render-scale')) }));
  const png = await page.screenshot({ path: info.outputPath('grass-boundary.png'), clip: (await canvas.boundingBox())!, timeout: 10000 });
  const colors = await page.evaluate(async ({ encoded, camera, bounds }) => {
    const image = await createImageBitmap(new Blob([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))], { type: 'image/png' }));
    const context = new OffscreenCanvas(image.width, image.height).getContext('2d')!; context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    const counts = [new Map<string, number>(), new Map<string, number>()];
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const wx = camera.x + (x - image.width / 2) / (8 * camera.scale);
      const wy = camera.y + (y - image.height / 2) / (8 * camera.scale);
      const inside = wx >= bounds.minX && wx <= bounds.maxX + 1 && wy >= bounds.minY && wy <= bounds.maxY + 1;
      const i = (y * image.width + x) * 4, r = pixels[i]!, g = pixels[i + 1]!, b = pixels[i + 2]!;
      if (g < r + 15 || r < b + 35) continue;
      const key = `${r},${g},${b}`, count = counts[inside ? 0 : 1]!;
      count.set(key, (count.get(key) ?? 0) + 1);
    }
    return counts.map(count => [...count].sort((a, b) => b[1] - a[1])[0]);
  }, { encoded: png.toString('base64'), camera, bounds: scene.city.bounds });
  console.log('GRASS_BOUNDARY_COLORS', colors);
  if (uniform) {
    expect(colors[0]?.[1]).toBeGreaterThan(1000);
    expect(colors[1]?.[1]).toBeGreaterThan(1000);
  }
  if (uniform) expect(colors[0]?.[0]).toBe(colors[1]?.[0]);
  expect(errors).toEqual([]);
});
