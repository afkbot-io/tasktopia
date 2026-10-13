import { Container, Graphics } from 'pixi.js';
import type { TaskActivityPose } from './task-activity-feedback';

/** Small hard-edged world cues. No text, hit targets, textures or extra actors. */
export function createTaskActivityView(place: (view: Container, x: number, y: number) => void) {
  const root = new Container({ eventMode: 'none', label: 'task-activity' });
  const views = new Map<string, { badge: Container; paper: Container; mark: Graphics; carried: Graphics; signature: string }>();
  const envelope = (g: Graphics) => g.rect(-5, -4, 10, 7).fill(0x30464c).rect(-4, -3, 8, 5).fill(0xe9d7a7)
    .rect(-3, -2, 1, 1).rect(2, -2, 1, 1).rect(-2, -1, 1, 1).rect(1, -1, 1, 1).rect(-1, 0, 2, 1).fill(0x9e865b);
  const document = (g: Graphics) => g.rect(-4, -5, 8, 10).fill(0x30464c).rect(-3, -4, 6, 8).fill(0xe9d7a7)
    .rect(-2, -2, 3, 1).rect(-2, 0, 2, 1).fill(0x9e865b).rect(-1, 2, 1, 1).rect(0, 3, 1, 1).rect(1, 2, 1, 1).rect(2, 1, 1, 1).fill(0x638974);
  return {
    root,
    get count() { return views.size; },
    update(poses: readonly TaskActivityPose[], now: number) {
      const wanted = new Set(poses.map(p => p.taskId));
      for (const [id, view] of views) if (!wanted.has(id)) { view.badge.destroy({ children: true }); view.paper.destroy({ children: true }); views.delete(id); }
      for (const pose of poses) {
        let view = views.get(pose.taskId);
        if (!view) {
          const badge = new Container({ eventMode: 'none' }), paper = new Container({ eventMode: 'none' });
          const mark = new Graphics(), carried = new Graphics(); badge.addChild(mark); paper.addChild(carried); root.addChild(badge, paper);
          view = { badge, paper, mark, carried, signature: '' }; views.set(pose.taskId, view);
        }
        const frame = !pose.static && pose.kind === 'COMMENT' && pose.phase === 'DISCUSS' ? Math.floor(now / 400) % 3 : 0;
        const signature = `${pose.kind}:${pose.phase}:${frame}`;
        if (signature !== view.signature) {
          view.signature = signature; view.mark.clear(); view.carried.clear();
          if (pose.kind === 'COMMENT' && pose.phase === 'DISCUSS') {
            view.mark.rect(-6, -4, 12, 7).rect(-3, 3, 2, 1).fill(0x30464c)
              .rect(-5, -3, 10, 5).fill(0xe9d7a7);
            for (let i = 0; i < 3; i++) view.mark.rect(-3 + i * 3, i === frame && !pose.static ? -1 : 0, 1, 1).fill(0x536b5c);
          } else if (pose.kind === 'COMMENT') envelope(view.mark);
          else document(view.mark);
          view.carried.rect(-2, -1, 5, 3).fill(0x30464c).rect(-1, 0, 3, 1).fill(pose.kind === 'COMMENT' ? 0xe9d7a7 : 0x8fb99c);
        }
        const alpha = pose.static ? 1 : Math.max(0, Math.min(1, (now - pose.startedAt) / 250, (pose.expiresAt - now) / 400));
        view.badge.alpha = alpha;
        place(view.badge, (pose.anchor.x + .5) * 8, (pose.anchor.y + .5) * 8 - 12);
        const carrier = pose.visitors.find(a => !a.visit?.arrived);
        view.paper.visible = !!carrier && !pose.static;
        if (carrier) { place(view.paper, carrier.position.x * 8 + 4, carrier.position.y * 8 - 4); view.paper.alpha = alpha; }
      }
    },
    destroy() { root.destroy({ children: true }); views.clear(); },
  };
}
