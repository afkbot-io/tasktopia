import { Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import { microAmbientSprite } from '../shared/micro-ambient';
import type { Cell, Rect } from '../shared/contracts';
import type { CityMobilityAgent } from './city-mobility';
import { cityLifeHash } from './city-life';
import { EVERYDAY_LABEL, dogFetchPose } from './city-everyday-life';
import type { EverydayState } from './city-everyday-controller';

/** Fixed-size authored props and small native activity/weather cues. Actors
 * come from mobility; this layer has no pointer targets or working controls. */
export function createEverydayView(texture: (key: string) => Texture | undefined, cached: (url: string) => Texture | undefined,
  place: (view: Sprite, x: number, y: number) => void) {
  const root = new Container({ label: 'everyday-city', eventMode: 'none' });
  const weather = new Graphics(), cues = new Graphics(), plate = new Graphics();
  const stall = new Sprite(), animals = Array.from({ length: 4 }, () => new Sprite());
  const caption = new Text({ text: '', resolution: 2, style: { fontFamily: 'Manrope, sans-serif', fontSize: 7, fontWeight: '600', fill: 0xf0e6bd } });
  caption.anchor.set(.5, 1); stall.anchor.set(.5, 1);
  for (const animal of animals) animal.anchor.set(.5);
  const stopViews = new Map<string, Sprite>(), umbrellas = new Map<string, Sprite>();
  let cells: Cell[] = [], lastWeatherFrame = -1;
  let lastRainPhase = '', animalEpisode = '', dogOwner = '', scatterAt: number | undefined;
  root.addChild(weather, stall, ...animals, cues, plate, caption);
  const hideActivity = () => { stall.visible = false; caption.visible = false; plate.visible = false; cues.clear(); for (const animal of animals) animal.visible = false; };
  return {
    root,
    compile(walk: ReadonlyMap<string, Cell>, roads: ReadonlyMap<string, Cell>, blocked: ReadonlySet<string>) {
      // A sparse deterministic sample; no full-graph scan on animation frames.
      cells = [];
      for (const graph of [walk, roads]) for (const [id, cell] of graph)
        if (!blocked.has(id) && cityLifeHash(id) % 11 === 0) cells.push(cell);
      lastWeatherFrame = -1;
    },
    update(state: EverydayState, agents: readonly CityMobilityAgent[], now: number, view: Rect, economy: boolean) {
      hideActivity();
      let dogCarrying = false;
      const wantedStops = new Set(state.stops.map(stop => stop.id));
      for (const [id, sprite] of stopViews) if (!wantedStops.has(id)) { sprite.destroy(); stopViews.delete(id); }
      for (const stop of state.stops) {
        let sprite = stopViews.get(stop.id);
        if (!sprite) { sprite = new Sprite({ eventMode: 'none', roundPixels: true }); sprite.anchor.set(.5, 1); root.addChildAt(sprite, 1); stopViews.set(stop.id, sprite); }
        const loaded = texture(`bus-stop-${stop.direction}`); if (loaded) sprite.texture = loaded;
        const left = Math.min(...stop.shelter.map(c => c.x)), bottom = Math.max(...stop.shelter.map(c => c.y)) + 1;
        sprite.position.set((left + 1) * 8, bottom * 8);
        sprite.visible = !!loaded && !agents.some(a => a.activity !== 'INSIDE' && stop.shelter.some(c => Math.abs(a.position.x - c.x - .5) < .8 && Math.abs(a.position.y - c.y - .5) < .8));
      }
      const pose = state.pose;
      if (pose?.id !== animalEpisode) { animalEpisode = pose?.id ?? ''; dogOwner = ''; scatterAt = undefined; }
      if (pose) {
        const anchor = pose.route.at(-1)!;
        const label = EVERYDAY_LABEL[pose.kind];
        if (caption.text !== label) {
          caption.text = label;
          plate.clear().rect(-caption.width / 2 - 3, -caption.height - 2, caption.width + 6, caption.height + 4).fill({ color: 0x183932, alpha: .9 });
        }
        caption.position.set((anchor.x + .5) * 8, (anchor.y + .5) * 8 - 14);
        plate.position.copyFrom(caption.position); caption.visible = true; plate.visible = true;
        const activity = pose.phase === 'ACTIVITY' && state.areaReady && state.visitors.some(a => a.visit?.arrived);
        if (pose.kind === 'MARKET' && activity) {
          const loaded = texture('city-event-market-stall'); if (loaded) { stall.texture = loaded; stall.visible = true; }
          const minX = Math.min(...pose.area.map(c => c.x)), maxY = Math.max(...pose.area.map(c => c.y));
          stall.position.set((minX + 1) * 8, (maxY + 1) * 8);
        }
        if (pose.kind === 'SPORT' && activity) {
          const corner = pose.area[0]!, x = corner.x * 8, y = corner.y * 8;
          cues.rect(x + 1, y + 1, 14, 1).rect(x + 1, y + 14, 14, 1).rect(x + 1, y + 2, 1, 12).rect(x + 14, y + 2, 1, 12).fill(0xc9c6a1);
          const swing = (now % 2400) / 2400, ball = swing < .5 ? swing * 2 : 2 - swing * 2;
          cues.rect(x + 5 + Math.round(ball * 5), y + 7, 2, 2).fill(0xf0e6bd).rect(x + 6 + Math.round(ball * 5), y + 8, 1, 1).fill(0x536366);
        }
        if ((pose.kind === 'DOG' || pose.kind === 'BIRDS') && activity) {
          if (pose.kind === 'BIRDS' && scatterAt === undefined && agents.some(a => a.kind === 'WALKER' && a.activity !== 'INSIDE'
            && a.visit?.id !== pose.id && pose.area.some(c => Math.hypot(a.position.x - c.x - .5, a.position.y - c.y - .5) < 2))) scatterAt = now;
          const animalTexture = cached(microAmbientSprite('animal', pose.kind === 'DOG' ? 'dog' : 'duck').url);
          const perimeter = [pose.area[0]!, pose.area[1]!, pose.area[3]!, pose.area[2]!, pose.area[0]!];
          const owner = state.visitors.find(a => a.id === dogOwner && a.visit?.arrived)
            ?? state.visitors.find(a => a.visit?.arrived)!;
          dogOwner = owner.id;
          const fetch = pose.kind === 'DOG' ? dogFetchPose(pose.area, owner.position, pose.elapsed) : undefined;
          dogCarrying = !!fetch?.carrying;
          const count = pose.kind === 'DOG' ? 1 : economy ? 2 : 3;
          for (let i = 0; i < count; i++) {
            const step = (now / (pose.kind === 'DOG' ? 1000 : 1900) + i * 1.25) % 4, from = perimeter[Math.floor(step)]!, to = perimeter[Math.floor(step) + 1]!;
            const position = fetch?.position ?? { x: from.x + (to.x - from.x) * (step % 1) + .5, y: from.y + (to.y - from.y) * (step % 1) + .5 };
            const animal = animals[i]!; if (animalTexture) animal.texture = animalTexture;
            animal.visible = !!animalTexture && !(pose.kind === 'BIRDS' && scatterAt !== undefined && now - scatterAt > 2400);
            let rise = 0;
            if (pose.kind === 'BIRDS' && scatterAt !== undefined) {
              const lift = Math.min(1, (now - scatterAt) / 2400); rise = Math.round(lift * 8); animal.alpha = 1 - lift;
            } else animal.alpha = 1;
            place(animal, position.x * 8, position.y * 8 - rise);
          }
          const center = pose.area[0]!;
          if (fetch) cues.rect(Math.round(fetch.ball.x * 8), Math.round(fetch.ball.y * 8) - (fetch.carrying ? 1 : 0), 2, 2).fill(0xe9c77c);
          else for (let i = 0; i < 4; i++) cues.rect((center.x + .7) * 8 + i * 2, (center.y + 1) * 8 + (i % 2), 1, 1).fill(0xe9c77c);
        }
        if (pose.kind.startsWith('OPEN_')) {
          const x = (anchor.x + .5) * 8, y = (anchor.y + .5) * 8;
          const split = pose.phase === 'ARRIVE' ? 0 : Math.min(4, Math.floor(pose.progress * 5));
          cues.rect(x - 7 - split, y - 6, 7, 1).rect(x + split, y - 6, 7, 1).fill(0xb75638);
          cues.rect(x - 8, y - 7, 1, 7).rect(x + 7, y - 7, 1, 7).fill(0xc9b889);
          if (pose.kind === 'OPEN_FIRE') {
            const engine = agents.find(a => a.response === 'FIRE' && a.activity === 'REST' && Math.hypot(a.position.x - anchor.x, a.position.y - anchor.y) <= 10);
            if (engine && pose.phase === 'ACTIVITY') {
              const sx = Math.round(engine.position.x * 8), sy = Math.round(engine.position.y * 8), pulse = Math.floor(now / 200) % 3;
              for (let i = 0; i < 9; i++) cues.rect(sx + i, sy - Math.round(Math.sin(i / 9 * Math.PI) * (3 + pulse)), 1, 1).fill(0x96c6df);
            }
          }
          if (pose.phase === 'ACTIVITY') for (let i = 0; i < (economy ? 4 : 8); i++)
            cues.rect(x - 8 + i * 2, y - 10 - ((Math.floor(now / 250) + i * 3) % 5), 1, 1).fill(i % 2 ? 0xe9c77c : 0x7bada2);
        }
      }
      if (state.transit?.phase === 'BOARD' || state.transit?.phase === 'ALIGHT') {
        const run = state.transit, bus = agents.find(a => a.id === run.vehicleId);
        if (bus) cues.rect(bus.position.x * 8 + (bus.direction === 'east' ? 1 : -2), bus.position.y * 8 + 1, 2, 1).fill(0xf0e6bd);
      }
      const rain = state.rain, weatherFrame = Math.floor(now / 120);
      if (lastRainPhase !== rain.phase || rain.phase !== 'DRY' && lastWeatherFrame !== weatherFrame) {
        lastWeatherFrame = weatherFrame; lastRainPhase = rain.phase; weather.clear();
        const visibleCells = rain.puddles > 0 ? cells.filter(c => c.x >= view.minX && c.x <= view.maxX && c.y >= view.minY && c.y <= view.maxY).slice(0, economy ? 12 : 28) : [];
        for (const cell of visibleCells) {
          const width = Math.max(1, Math.round(5 * rain.puddles));
          weather.rect(cell.x * 8 + 1, cell.y * 8 + 5, width, 1).rect(cell.x * 8 + 2, cell.y * 8 + 4, Math.max(1, width - 2), 1).fill(0x6c939d);
        }
        for (let i = 0; i < Math.round((economy ? 24 : 56) * rain.intensity); i++) {
          const hash = cityLifeHash(`${rain.id}:${i}`), x = (view.minX + (hash % 1009) / 1009 * (view.maxX - view.minX)) * 8;
          const y = (view.minY + ((hash % 997) / 997 + (weatherFrame % 20) / 20) % 1 * (view.maxY - view.minY)) * 8;
          weather.rect(Math.round(x), Math.round(y), 1, 2).fill(0x93b6bb);
        }
        if (rain.puddles > .4) for (const car of agents.filter(a => a.kind === 'CAR' && a.activity === 'NONE' && a.waitMs === 0).slice(0, economy ? 4 : 10)) {
          weather.rect(Math.round(car.position.x * 8) - 3, Math.round(car.position.y * 8) + 2, 1, 1).rect(Math.round(car.position.x * 8) + 3, Math.round(car.position.y * 8) + 2, 1, 1).fill(0x9ac7ce);
        }
      }
      const wet = new Set<string>();
      if (rain.intensity > .2) for (const actor of agents.filter(a => a.kind === 'WALKER' && a.activity !== 'INSIDE'
        && !state.sheltered.has(a.id) && cityLifeHash(a.id) % 3 !== 0).slice(0, economy ? 12 : 32)) {
        wet.add(actor.id); let umbrella = umbrellas.get(actor.id);
        if (!umbrella) { umbrella = new Sprite({ eventMode: 'none', roundPixels: true }); umbrella.anchor.set(.5); root.addChild(umbrella); umbrellas.set(actor.id, umbrella); }
        const loaded = texture('city-event-umbrella'); if (loaded) umbrella.texture = loaded;
        umbrella.visible = !!loaded; place(umbrella, actor.position.x * 8, actor.position.y * 8 - 1);
      }
      for (const [id, umbrella] of umbrellas) if (!wet.has(id)) { umbrella.destroy(); umbrellas.delete(id); }
      return { umbrellas: wet.size, weatherPrimitives: rain.phase === 'DRY' ? 0 : 1, stops: stopViews.size, animals: animals.filter(a => a.visible).length, birdsScattered: scatterAt !== undefined, dogCarrying };
    },
    destroy() { root.destroy({ children: true }); stopViews.clear(); umbrellas.clear(); cells = []; },
  };
}
