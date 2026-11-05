import { Sprite, type Texture } from 'pixi.js';
import type { TransitStop } from './city-everyday-life';

/** Permanent street furniture. Its identity and visibility never depend on
 * nearby actors, event admission, quality or the animation clock. */
export function createTransitStopView(texture: (key: string) => Texture | undefined, attach: (sprite: Sprite) => void) {
  const records = new Map<string, { sprite: Sprite; ready: boolean }>();
  let last: readonly TransitStop[] | undefined, complete = false, counts = { total: 0, visible: 0 };
  return {
    update(stops: readonly TransitStop[]) {
      if (stops === last && complete) return counts;
      if (stops !== last) {
        const wanted = new Set(stops.map(stop => stop.id));
        for (const [id, record] of records) if (!wanted.has(id)) { record.sprite.destroy(); records.delete(id); }
      }
      complete = true;
      let visible = 0;
      for (const stop of stops) {
        let record = records.get(stop.id);
        if (!record) {
          const sprite = new Sprite({ label: `transit-stop:${stop.id}`, eventMode: 'none', roundPixels: true });
          sprite.anchor.set(.5, 1); sprite.visible = false; attach(sprite);
          record = { sprite, ready: false }; records.set(stop.id, record);
        }
        const loaded = texture(`bus-stop-${stop.direction}`);
        if (loaded) { record.sprite.texture = loaded; record.ready = true; }
        const x = (Math.min(...stop.shelter.map(cell => cell.x)) + 1) * 8;
        const y = (Math.max(...stop.shelter.map(cell => cell.y)) + 1) * 8;
        if (record.sprite.x !== x || record.sprite.y !== y) record.sprite.position.set(x, y);
        record.sprite.visible = record.ready;
        if (record.ready) visible++; else complete = false;
      }
      last = stops; counts = { total: records.size, visible };
      return counts;
    },
    destroy() {
      for (const { sprite } of records.values()) sprite.destroy();
      records.clear(); last = undefined; complete = false; counts = { total: 0, visible: 0 };
    },
  };
}
