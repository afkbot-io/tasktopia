import { expect, it, vi } from 'vitest';
import { Container, Sprite, Texture } from 'pixi.js';
import { createTransitStopView } from '../src/client/city-transit-stop-view';
import type { TransitStop } from '../src/client/city-everyday-life';

const stop: TransitStop = { id: 'stop:12,1', direction: 'horizontal', lane: { x: 12, y: 1 },
  shelter: [{ x: 12, y: 3 }, { x: 13, y: 3 }, { x: 12, y: 4 }, { x: 13, y: 4 }],
  queue: [{ x: 12, y: 2 }], route: [{ x: 12, y: 2 }] };

it('retains permanent stop sprites and performs no per-frame texture or position work', () => {
  const parent = new Container(), texture = vi.fn(() => Texture.EMPTY);
  const view = createTransitStopView(texture, sprite => parent.addChild(sprite)), stops = [stop];
  try {
    expect(view.update(stops)).toEqual({ total: 1, visible: 1 });
    const sprite = parent.children[0] as Sprite, set = vi.spyOn(sprite.position, 'set');
    expect(sprite.label).toBe('transit-stop:stop:12,1'); expect(sprite.visible).toBe(true);
    expect({ x: sprite.x, y: sprite.y }).toEqual({ x: 104, y: 40 });
    texture.mockClear();
    for (let frame = 0; frame < 120; frame++) view.update(stops);
    expect(texture).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled();
    expect(parent.children[0]).toBe(sprite);
    view.update([structuredClone(stop)]);
    expect(parent.children[0]).toBe(sprite); expect(sprite.visible).toBe(true);
  } finally { view.destroy(); expect(parent.children).toHaveLength(0); parent.destroy(); }
});

it('retries a missing atlas frame without replacing the stop and releases a removed stop', () => {
  const parent = new Container(); let ready = false;
  const view = createTransitStopView(() => ready ? Texture.EMPTY : undefined, sprite => parent.addChild(sprite));
  const stops = [stop];
  try {
    expect(view.update(stops)).toEqual({ total: 1, visible: 0 });
    const sprite = parent.children[0]; ready = true;
    expect(view.update(stops)).toEqual({ total: 1, visible: 1 }); expect(parent.children[0]).toBe(sprite);
    expect(view.update([])).toEqual({ total: 0, visible: 0 }); expect(sprite.destroyed).toBe(true);
  } finally { view.destroy(); parent.destroy(); }
});
