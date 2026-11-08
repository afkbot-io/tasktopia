import { Container, Sprite, type Texture } from 'pixi.js';
import type { Rect } from '../shared/contracts';
import { sampleCloudShadows } from './city-weather';

/** Authored cloud silhouettes cast low-contrast, nearest-neighbour shadows.
 * The layer is below aircraft and outside all task/input hit targets. */
export function createCloudShadowView(texture: (variant: number) => Texture | undefined) {
  const root = new Container({ label: 'city-cloud-shadows', eventMode: 'none' });
  const sprites = new Map<string, Sprite>();
  let frame = -1, bounds = '', quality = false, city = '', complete = false;
  let snapshot = { visible: 0, visited: 0, poses: [] as Array<{ id: string; x: number; y: number }> };
  const clear = () => {
    for (const sprite of sprites.values()) sprite.destroy();
    sprites.clear(); frame = -1; complete = false;
    snapshot = { visible: 0, visited: 0, poses: [] };
  };
  return {
    root,
    update(cityId: string, now: number, view: Rect, economy: boolean, enabled: boolean) {
      if (!enabled) { if (frame !== -1) clear(); return snapshot; }
      const tick = Math.floor(now / 120), nextBounds = `${Math.floor(view.minX)},${Math.floor(view.minY)},${Math.ceil(view.maxX)},${Math.ceil(view.maxY)}`;
      if (complete && tick === frame && bounds === nextBounds && quality === economy && city === cityId) return snapshot;
      const sampled = sampleCloudShadows(cityId, tick * 120, view, economy), wanted = new Set(sampled.poses.map(p => p.id));
      for (const [id, sprite] of sprites) if (!wanted.has(id)) { sprite.destroy(); sprites.delete(id); }
      complete = true;
      for (const pose of sampled.poses) {
        let sprite = sprites.get(pose.id);
        if (!sprite) {
          const loaded = texture(pose.variant);
          if (!loaded) { complete = false; continue; }
          sprite = new Sprite({ label: pose.id, texture: loaded, eventMode: 'none', roundPixels: true });
          sprite.anchor.set(.5); sprite.scale.set(pose.scale); sprite.tint = 0x4b6254; sprite.alpha = .16; sprite.blendMode = 'multiply';
          sprites.set(pose.id, sprite); root.addChild(sprite);
        }
        sprite.position.set(Math.round(pose.x), Math.round(pose.y));
      }
      frame = tick; bounds = nextBounds; quality = economy; city = cityId;
      snapshot = { visible: sprites.size, visited: sampled.visited,
        poses: [...sprites].map(([id, sprite]) => ({ id, x: sprite.x, y: sprite.y })) };
      return snapshot;
    },
    destroy() { clear(); root.destroy(); },
  };
}
