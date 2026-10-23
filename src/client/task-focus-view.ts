import { BufferImageSource, Container, Rectangle, Sprite, Texture } from 'pixi.js';
import type { ChunkTaskDto } from '../shared/contracts';
import { TASK_SPRINT_BADGES, taskAttentionAlpha, taskSprintBadge, type TaskSprintBadgeKind } from './task-focus-presentation';

type View = { view: Container };
type FocusInput = {
  tasks: ReadonlyMap<string, ChunkTaskDto>;
  buildings: ReadonlyMap<string, View>;
  platforms: ReadonlyMap<string, View>;
  incidents: ReadonlyMap<string, { container: Container }>;
  activeDistrictIds: ReadonlySet<string>;
  matches?: ReadonlySet<string>;
  detail: boolean;
};

/** Updates existing resident views only. No network, geometry rebuild or ticker. */
export function createTaskFocusView() {
  const textures = new Map<TaskSprintBadgeKind, Texture>();
  let source: BufferImageSource | undefined;
  const owners = new WeakMap<Container, string>();
  const fades = new WeakMap<Container, number>();
  let matches: ReadonlySet<string> | undefined;
  const opacity = (view: Container, id: string) => {
    owners.set(view, id);
    view.alpha = (fades.get(view) ?? 1) * taskAttentionAlpha(id, matches);
  };
  const badges = new Map<string, { building: Container; view: Sprite; kind: TaskSprintBadgeKind }>();
  const release = (id: string) => {
    const badge = badges.get(id);
    if (!badge) return;
    if (!badge.view.destroyed) { badge.view.removeFromParent(); badge.view.destroy(); }
    badges.delete(id);
  };
  const texture = (kind: TaskSprintBadgeKind) => {
    if (!source) {
      // All signs share one tiny nearest-neighbour atlas (2,904 RGBA bytes).
      // Sprites remain batchable even when hundreds of tasks are visible.
      const definitions = Object.values(TASK_SPRINT_BADGES);
      const width = definitions.length * 11;
      const resource = new Uint8Array(width * 11 * 4);
      definitions.forEach((definition, index) => {
        for (const { x, y, color } of definition.pixels) {
          const offset = (y * width + index * 11 + x) * 4;
          resource[offset] = color >>> 16 & 255;
          resource[offset + 1] = color >>> 8 & 255;
          resource[offset + 2] = color & 255;
          resource[offset + 3] = 255;
        }
      });
      source = new BufferImageSource({ resource, width, height: 11, format: 'rgba8unorm', scaleMode: 'nearest' });
      definitions.forEach((definition, index) => textures.set(definition.kind,
        new Texture({ source, frame: new Rectangle(index * 11, 0, 11, 11) })));
    }
    return textures.get(kind)!;
  };
  return {
    setFadeOpacity(view: Container, alpha: number) {
      if (alpha === 1) fades.delete(view); else fades.set(view, alpha);
      const id = owners.get(view);
      view.alpha = alpha * (id === undefined ? 1 : taskAttentionAlpha(id, matches));
    },
    update(input: FocusInput) {
      matches = input.matches;
      let dimmed = 0;
      for (const [id, badge] of badges) if (input.buildings.get(id)?.view !== badge.building || badge.view.destroyed) release(id);
      for (const [id, { view }] of input.platforms) opacity(view, id);
      for (const [id, { container }] of input.incidents) opacity(container, id);
      for (const [id, { view }] of input.buildings) {
        opacity(view, id);
        if (taskAttentionAlpha(id, matches) < 1) dimmed++;
        const task = input.tasks.get(id);
        const definition = input.detail && task ? taskSprintBadge(task, input.activeDistrictIds) : undefined;
        const old = badges.get(id);
        if (!definition) { release(id); continue; }
        if (old?.kind === definition.kind) continue;
        release(id);
        const bounds = view.getLocalBounds().rectangle;
        const badge = new Sprite(texture(definition.kind));
        badge.label = `task-sprint-badge:${id}:${definition.kind}`;
        badge.eventMode = 'none';
        // Keep the small sign inside the existing sprite, away from the
        // number plaque and without changing its world depth or hit area.
        badge.position.set(Math.round(bounds.x + bounds.width - definition.width - 2), Math.round(bounds.y + 2));
        view.addChild(badge);
        badges.set(id, { building: view, view: badge, kind: definition.kind });
      }
      return { dimmed, badges: badges.size, textures: source ? 1 : 0 };
    },
    destroy() {
      for (const id of badges.keys()) release(id);
      for (const value of textures.values()) value.destroy(false);
      textures.clear();
      source?.destroy();
      source = undefined;
    },
  };
}
