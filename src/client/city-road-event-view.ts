import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import { microAmbientSprite, microDirection } from "../shared/micro-ambient";
import { incidentEffectPixels } from "./incident-pixels";
import { roadEpisodePose, type RoadEpisode } from "./city-road-events";
import type { CityMobilityAgent } from './city-mobility';

/** One bounded, non-interactive pixel scene on a temporarily closed lane. */
export function createCityRoadEventView(texture: (key: string) => Texture | undefined, cached: (url: string) => Texture | undefined, place?: (sprite: Sprite, x: number, y: number) => void) {
  const root = new Container({ label: "city-road-event", eventMode: "none" });
  const pixels = new Graphics(), cars = [new Sprite(), new Sprite()], workers = [new Sprite(), new Sprite()];
  for (const car of cars) car.anchor.set(.5);
  for (const worker of workers) worker.anchor.set(.5, 1);
  root.addChild(...cars, ...workers, pixels); root.visible = false;
  return {
    root,
    update(episode: RoadEpisode | undefined, now: number, economy: boolean, responder?: CityMobilityAgent) {
      const pose = episode && roadEpisodePose(episode, now);
      root.visible = !!pose; if (!episode || !pose) return;
      pixels.clear();
      for (const view of [...cars, ...workers]) view.visible = false;
      const direction = microDirection(episode.cells[0]!, episode.cells[1]!);
      const accident = episode.kind === "ACCIDENT" || episode.kind === "FIRE" || episode.kind === 'BREAKDOWN' && !episode.cargoLoaded;
      if (accident) for (const [index, car] of cars.entries()) {
        if (index && episode.kind !== "ACCIDENT") continue;
        const art = microAmbientSprite("car", index ? "hatchback" : "pickup", direction), loaded = cached(art.url);
        if (!loaded) continue;
        car.texture = loaded; car.visible = true;
        const cell = episode.cells[index * 2]!; car.position.set((cell.x + .5) * 8, (cell.y + .5) * 8);
        if (episode.kind === 'BREAKDOWN' && episode.serviceArrival !== undefined && responder && episode.towCell) {
          const along = Math.max(0, Math.min(1, (now - episode.serviceArrival - 800) / 3200));
          const destination = episode.towCell;
          car.position.set((cell.x + .5 + (destination.x - cell.x) * along) * 8,
            (cell.y + .5 + (destination.y - cell.y) * along) * 8 - Math.round(Math.sin(along * Math.PI) * 3));
          const x = responder.position.x * 8, y = responder.position.y * 8;
          for (let i = 0; i < 8; i++) pixels.rect(Math.round(car.x + (x - car.x) * i / 8), Math.round(car.y + (y - car.y) * i / 8), 1, 1).fill(0xc9b889);
        }
        place?.(car, car.x, car.y);
      }
      if (episode.kind === "REPAIR" || episode.kind === 'WATER' && episode.serviceArrival !== undefined) for (const [index, worker] of workers.entries()) {
        if (economy && index) continue;
        const loaded = texture(`compact-construction-worker-${direction}-${Math.floor(now / 220 + index) % 2}`);
        if (!loaded) continue;
        worker.texture = loaded; worker.visible = true;
        const cell = episode.cells[index * 2]!; worker.position.set((cell.x + .5) * 8, (cell.y + 1) * 8);
        pixels.rect(cell.x * 8 + 2, cell.y * 8 + 2, 4, 2).fill(0x536366);
      }
      if (episode.kind === 'WATER') {
        const cell = episode.cells[1]!, x = (cell.x + .5) * 8, y = (cell.y + .5) * 8;
        const repairing = episode.serviceArrival !== undefined && now - episode.serviceArrival > 6000;
        if (!repairing) {
          const pulse = Math.floor(now / 160) % 3;
          pixels.rect(x - 1, y - 7 - pulse, 2, 7 + pulse).rect(x - 3, y - 7 - pulse, 6, 1).fill(0x96c6df);
          pixels.rect(x - 4, y - 5, 1, 2).rect(x + 3, y - 6, 1, 2).fill(0xb9d6d0);
        } else if (now - episode.serviceArrival! < 14000) pixels.rect(x - 3, y - 1, 6, 3).fill(0x756349).rect(x - 2, y, 4, 1).fill(0x536366);
        else pixels.rect(x - 3, y - 1, 6, 3).fill(0x7b8583);
      }
      if (episode.kind !== "PATROL" && !episode.cargoLoaded) for (const cell of [episode.cells[0]!, episode.cells[2]!]) {
        const x = (cell.x + .5) * 8, y = cell.y * 8;
        pixels.rect(x - 1, y, 2, 1).fill(0xe9c77c).rect(x - 2, y + 1, 4, 2).fill(0xe59043).rect(x - 3, y + 3, 6, 1).fill(0x536366);
      }
      if (episode.kind === "FIRE" || episode.kind === "ACCIDENT" || episode.kind === 'BREAKDOWN' && episode.serviceArrival === undefined) {
        const cell = episode.cells[0]!;
        for (const p of incidentEffectPixels(episode.kind === "FIRE" && pose.phase !== "CLEAR" ? "flame" : "smoke", Math.floor(now / 240)))
          pixels.rect((cell.x + .5) * 8 + p.x, (cell.y + .5) * 8 + p.y, 1, 1).fill(p.color);
      }
      if (episode.kind === "MEDICAL") {
        const cell = episode.cells[1]!, x = (cell.x + .5) * 8, y = (cell.y + .5) * 8;
        pixels.rect(x - 3, y - 1, 6, 2).fill(0xded5b2).rect(x - 2, y, 4, 1).fill(0xb75638);
      }
    },
  };
}
