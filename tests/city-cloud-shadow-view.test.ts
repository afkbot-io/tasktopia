import { expect, it } from 'vitest';
import { Texture } from 'pixi.js';
import { createCloudShadowView } from '../src/client/city-cloud-shadow-view';

it('retries optional missing art and retains only bounded, noninteractive shadows with explicit cleanup', () => {
  let ready = false, loads = 0;
  const view = createCloudShadowView(() => { loads++; return ready ? Texture.WHITE : undefined; });
  const bounds = { minX: -50, minY: -40, maxX: 120, maxY: 100 };
  try {
    expect(view.update('city', 100_000, bounds, false, true).visible).toBe(0);
    ready = true;
    const frame = view.update('city', 100_120, bounds, false, true);
    expect(frame.visible).toBeGreaterThan(0);
    expect(view.root.eventMode).toBe('none');
    expect(view.root.children.length).toBeLessThanOrEqual(12);
    expect(view.root.children.every(sprite => sprite.rotation === 0 && sprite.scale.x === sprite.scale.y)).toBe(true);
    loads = 0;
    view.update('city', 100_130, bounds, false, true);
    expect(loads).toBe(0);
    expect(view.update('city', 100_240, bounds, true, true).visible).toBeLessThanOrEqual(6);
    expect(view.update('city', 100_250, bounds, false, false).visible).toBe(0);
    expect(view.root.children.length).toBe(0);
    expect(view.update('city', 100_360, bounds, false, true).visible).toBeGreaterThan(0);
  } finally { view.destroy(); }
  expect(view.root.destroyed).toBe(true);
});
