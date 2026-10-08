import { Container, Graphics, Sprite, FederatedPointerEvent, EventBoundary, type Texture } from "pixi.js";
import type { Cell, ChunkTaskDto, Rect } from "../shared/contracts";
import { microDirection } from "../shared/micro-ambient";
import { createCityCinematics, type CityCinematicFrame, type CityCinematicRequest } from "./city-cinematics";
import { planCinematicCrew } from "./city-cinematic-crew";
import { incidentEffectPixels } from "./incident-pixels";

type Capture = { task: ChunkTaskDto; building: Container; platform?: Container };
type Target = { task?: ChunkTaskDto; building?: Container; platform?: Container; markers: Container[]; version: number };
type Shot = Capture & { x: number; y: number; platformX: number; platformY: number; bounds: Rect; visual: {x:number;y:number;width:number;height:number}; root: Container; pixels: Graphics; aircraft: Sprite;
  workers: { view: Sprite; path: Cell[] }[]; hidden: Set<Container>; target?: Target; sounded: Set<string> };
type Options = { layer: Container; airLayer: Container; texture(key: string): Texture | undefined;
  walk(): ReadonlyMap<string, Cell>; roads(): ReadonlySet<string>; economy(): boolean;
  sound(cue: "hammer" | "blast" | "rotor" | "reveal"): void; complete(frame: CityCinematicFrame, bounds: Rect): void };

/** Owns only captured presentation objects. Authoritative task records remain
 * in the renderer, including while their sprites are temporarily concealed. */
export function createCityCinematicView(options: Options) {
  const timeline = createCityCinematics();
  const shots = new Map<string, Shot>();
  let reserved: ReadonlySet<string> = new Set();
  const reservePaths = () => { reserved = new Set([...shots.values()].flatMap(shot => shot.workers.flatMap(w => w.path.map(c => `${c.x},${c.y}`)))); };
  const showTargets = (shot: Shot) => {
    for (const view of shot.hidden) if (!view.destroyed) view.visible = true;
    shot.hidden.clear();
  };
  const release = (id: string) => {
    const shot = shots.get(id); if (!shot) return;
    showTargets(shot);
    shot.building.removeFromParent(); shot.building.destroy({ children: true });
    shot.platform?.removeFromParent(); shot.platform?.destroy({ children: true });
    shot.root.removeFromParent(); shot.root.destroy({ children: true });
    shots.delete(id);
    reservePaths();
  };
  const gate = (shot: Shot, reveal: boolean) => {
    showTargets(shot);
    if (reveal || !shot.target) return;
    for (const view of [shot.target.building, shot.target.platform, ...shot.target.markers]) {
      if (!view || view.destroyed || view === shot.building || view === shot.platform) continue;
      view.visible = false; shot.hidden.add(view);
    }
  };
  return {
    begin(request: CityCinematicRequest, capture: Capture | undefined, now: number) {
      const existing = shots.get(request.taskId);
      if (!existing && (!capture || capture.building.destroyed || shots.size >= (options.economy() ? 1 : 3))) return false;
      if (!timeline.begin(request, now)) return false;
      if (existing) { if (request.kind !== "CONSTRUCT") { existing.building.eventMode = "none"; existing.building.interactiveChildren = false; } return true; }
      if (!capture) return false;
      const occupied = new Set([...shots.values()].flatMap(shot => shot.workers.flatMap(w => w.path.map(c => `${c.x},${c.y}`))));
      const paths = request.kind === "TRANSFER" ? [] : planCinematicCrew(capture.task, options.walk(), options.roads(), occupied, options.economy() ? 3 : 6);
      const root = new Container({ label: `cinematic-${request.taskId}`, eventMode: "none" });
      const pixels = new Graphics(), aircraft = new Sprite();
      aircraft.anchor.set(.5); aircraft.visible = false;
      const workers = paths.map(path => {
        const view = new Sprite(options.texture("compact-construction-worker-south-0"));
        view.anchor.set(.5, 1); root.addChild(view); return { view, path };
      });
      root.addChild(pixels, aircraft); options.layer.addChild(root);
      const bounds = capture.task.siteBounds ?? {
        minX: Math.min(...capture.task.footprint.map(c => c.x)), minY: Math.min(...capture.task.footprint.map(c => c.y)),
        maxX: Math.max(...capture.task.footprint.map(c => c.x)), maxY: Math.max(...capture.task.footprint.map(c => c.y)),
      };
      capture.building.emit("pointerout", new FederatedPointerEvent(new EventBoundary(capture.building)));
      capture.building.removeAllListeners("pointerover");
      if (request.kind !== "CONSTRUCT") { capture.building.eventMode = "none"; capture.building.interactiveChildren = false; }
      shots.set(request.taskId, { ...capture, x: capture.building.x, y: capture.building.y, platformX: capture.platform?.x ?? 0, platformY: capture.platform?.y ?? 0, bounds,
        visual: { ...capture.building.getLocalBounds().rectangle }, root, pixels, aircraft, workers, hidden: new Set(), sounded: new Set() });
      reservePaths();
      return true;
    },
    has(id: string) { return shots.has(id); },
    reservedCells() { return reserved; },
    target(id: string, target: Target) {
      const shot = shots.get(id); if (!shot) return;
      showTargets(shot); shot.target = target;
      if (target.version >= 0) timeline.ready(id, target.version);
      gate(shot, false);
    },
    update(now: number) {
      const frames = timeline.sample(now);
      for (const frame of frames) {
        const shot = shots.get(frame.taskId); if (!shot) continue;
        if (frame.done) { options.complete(frame, shot.bounds); release(frame.taskId); continue; }
        gate(shot, frame.revealTarget);
        const { pixels, building, platform, bounds, aircraft } = shot;
        pixels.clear(); aircraft.visible = false;
        const cx = (bounds.minX + bounds.maxX + 1) * 4, cy = (bounds.minY + bounds.maxY + 1) * 4;
        const cue = frame.kind === "TRANSFER" ? "rotor" : frame.phase === "WORK" ? "hammer" : frame.phase === "COVER" && frame.kind === "DEMOLISH" ? "blast" : frame.phase === "REVEAL" ? "reveal" : undefined;
        const cueKey = cue === "hammer" || cue === "rotor" ? `${cue}:${Math.floor(frame.elapsedMs / (cue === "rotor" ? 600 : 350))}` : cue;
        if (cue && cueKey && !shot.sounded.has(cueKey)) { shot.sounded.add(cueKey); options.sound(cue); }
        building.visible = frame.oldVisible;
        building.position.set(shot.x, shot.y);
        if (platform) platform.visible = frame.oldVisible;
        for (const [index, worker] of shot.workers.entries()) {
          worker.view.visible = frame.kind !== "TRANSFER" && !frame.revealTarget;
          const retreat = frame.phase === "COVER" || frame.kind === "DEMOLISH" && frame.phase === "WORK" && frame.phaseProgress > .5;
          const retreatProgress = frame.phase === "COVER" ? 1 : Math.max(0, (frame.phaseProgress - .5) * 2);
          const along = (retreat ? 1 - retreatProgress : frame.phase === "CREW" ? frame.phaseProgress : 1) * (worker.path.length - 1);
          const i = Math.min(worker.path.length - 2, Math.floor(along));
          const a = worker.path[i]!, b = worker.path[i + 1]!, p = along - i;
          const direction = microDirection(retreat ? b : a, retreat ? a : b);
          const texture = options.texture(`compact-construction-worker-${direction}-${frame.phase === "WORK" ? Math.floor((frame.elapsedMs + index * 70) / 180) % 2 : 0}`);
          if (texture) worker.view.texture = texture;
          worker.view.position.set(Math.round((a.x + (b.x - a.x) * p + .5) * 8), Math.round((a.y + (b.y - a.y) * p + 1) * 8));
        }
        if (frame.kind === "TRANSFER") {
          for (const worker of shot.workers) worker.view.visible = false;
          const target = shot.target?.building;
          const carry = frame.phase === "CARRY" ? frame.phaseProgress : ["LOWER", "DEPART"].includes(frame.phase) ? 1 : 0;
          const dx = target ? target.x - shot.x : 0, dy = target ? target.y - shot.y : 0;
          const lift = frame.phase === "LIFT" ? frame.phaseProgress : frame.phase === "LOWER" ? 1 - frame.phaseProgress : frame.phase === "CARRY" ? 1 : 0;
          const x = Math.round(shot.x + dx * carry), y = Math.round(shot.y + dy * carry - lift * 24);
          if (["LIFT", "CARRY", "LOWER"].includes(frame.phase)) {
            if (building.parent !== options.airLayer) { if (platform) options.airLayer.addChild(platform); options.airLayer.addChild(building); }
            building.position.set(x, y);
            if (platform) { platform.visible = frame.oldVisible; platform.position.set(Math.round(shot.platformX + dx * carry), Math.round(shot.platformY + dy * carry - lift * 24)); }
            pixels.rect(Math.round(cx + dx * carry - 8), Math.round(cy + dy * carry - 3), 16, 5).fill({ color: 0x243b35, alpha: .3 });
          }
          const approach = frame.phase === "APPROACH" ? (1 - frame.phaseProgress) * 64 : 0;
          const depart = frame.phase === "DEPART" ? frame.phaseProgress * 80 : 0;
          const helicopterX = Math.round(x + shot.visual.x + shot.visual.width / 2 - approach + depart), helicopterY = Math.round(y + shot.visual.y - 18 - depart / 2);
          const direction = carry > 0 && carry < 1 ? microDirection({ x: 0, y: 0 }, { x: dx, y: dy }) : "east";
          const texture = options.texture(`compact-cargo-helicopter-${direction}`);
          if (texture) { aircraft.texture = texture; aircraft.visible = true; aircraft.position.set(helicopterX, helicopterY); }
          if (["LIFT", "CARRY", "LOWER"].includes(frame.phase)) {
            pixels.moveTo(helicopterX - 3, helicopterY + 4).lineTo(x - 6, y + shot.visual.y + 6);
            pixels.moveTo(helicopterX + 3, helicopterY + 4).lineTo(x + 6, y + shot.visual.y + 6).stroke({ color: 0xb9bc9e, width: 1 });
          }
          if (Math.floor(frame.elapsedMs / 90) % 2) pixels.rect(helicopterX - 10, helicopterY - 1, 20, 1).fill(0x536366);
        } else {
          if (frame.phase === "WORK") {
            building.x += Math.floor(frame.elapsedMs / 100) % 2;
            for (let i = 0; i < 6; i++) for (const p of incidentEffectPixels("smoke", Math.floor(frame.elapsedMs / 180) + i)) {
              pixels.rect(Math.round(bounds.minX * 8 + 4 + i * (bounds.maxX - bounds.minX) * 8 / 5 + p.x), Math.round(bounds.minY * 8 - 7 + p.y - frame.phaseProgress * 5), 1, 1).fill(p.color);
            }
            if (frame.kind === "DEMOLISH") {
              for (let i = 0; i < 3; i++) pixels.rect(bounds.minX * 8 + i * 8 + 2, (bounds.maxY + 1) * 8, 3, 2).fill(0xb75638);
            } else for (let i = 0; i < 3; i++) pixels.rect(cx + i * 3 - 3, cy + Math.floor(frame.elapsedMs / 70) % 3, 1, 1).fill(0xe9c77c);
          }
          if (frame.phase === "COVER" || frame.phase === "REVEAL") {
            const p = frame.phase === "COVER" ? Math.min(1, frame.phaseProgress * 3) : 1 - frame.phaseProgress;
            const width = Math.max(32, shot.visual.width + 12), height = Math.max(32, shot.visual.height + 12);
            const dustX = shot.x + shot.visual.x + shot.visual.width / 2, dustY = shot.y + shot.visual.y + shot.visual.height / 2;
            // Irregular stepped puffs, in whole native pixels; a continuous
            // opaque cover conceals the appearance change, without screen flash.
            for (let row = -1; row <= 1; row++) for (let col = -1; col <= 1; col++) {
              const radius = Math.round(Math.max(width, height) / 3 * p);
              const px = Math.round(dustX + col * width / 4 + (row % 2) * 3), py = Math.round(dustY + row * height / 4 + col * 2);
              for (let dy = -radius; dy <= radius; dy += 2) {
                const half = Math.floor(Math.sqrt(Math.max(0, radius * radius - dy * dy)));
                if (half) pixels.rect(px - half, py + dy, half * 2, 2).fill((row + col) % 2 ? 0xb9bc9e : 0xded5b2);
              }
            }
            if (frame.kind === "DEMOLISH" && frame.phase === "COVER" && frame.phaseProgress < .15) pixels.rect(cx - 3, cy - 4, 6, 6).fill(0xe9c77c);
          }
        }
      }
      return { frames, states: frames.filter(frame => !frame.done).map(frame => { const shot = shots.get(frame.taskId); return {taskId:frame.taskId,kind:frame.kind,phase:frame.phase,fromStage:frame.fromStage,toStage:frame.toStage,oldVisible:shot?.building.visible??false,targetVisible:shot?.target?.building?.visible??false,aircraftVisible:shot?.aircraft.visible??false,x:shot?.building.x,y:shot?.building.y}; }), workers: [...shots.values()].reduce((n, shot) => n + shot.workers.filter(w => w.view.visible).length, 0), ghosts: shots.size };
    },
    cancel(id: string) { timeline.cancel(id); release(id); },
    clear() { timeline.clear(); for (const id of [...shots.keys()]) release(id); },
  };
}
