import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import { microAmbientSprite, microDirection } from "../shared/micro-ambient";
import { incidentEffectPixels } from "./incident-pixels";
import { roadEpisodePose, type RoadEpisode } from "./city-road-events";

/** One bounded, non-interactive pixel scene on a temporarily closed lane. */
export function createCityRoadEventView(texture: (key: string) => Texture | undefined, cached: (url: string) => Texture | undefined) {
  const root = new Container({ label: "city-road-event", eventMode: "none" });
  const pixels = new Graphics(), cars = [new Sprite(), new Sprite()], workers = [new Sprite(), new Sprite()];
  for (const car of cars) car.anchor.set(.5);
  for (const worker of workers) worker.anchor.set(.5, 1);
  root.addChild(...cars, ...workers, pixels); root.visible = false;
  return {
    root,
    update(episode: RoadEpisode | undefined, now: number, economy: boolean) {
      const pose = episode && roadEpisodePose(episode, now);
      root.visible = !!pose; if (!episode || !pose) return;
      pixels.clear();
      for (const view of [...cars, ...workers]) view.visible = false;
      const direction = microDirection(episode.cells[0]!, episode.cells[1]!);
      const accident = episode.kind === "ACCIDENT" || episode.kind === "FIRE";
      if (accident) for (const [index, car] of cars.entries()) {
        if (index && episode.kind === "FIRE") continue;
        const art = microAmbientSprite("car", index ? "hatchback" : "pickup", direction), loaded = cached(art.url);
        if (!loaded) continue;
        car.texture = loaded; car.visible = true;
        const cell = episode.cells[index * 2]!; car.position.set((cell.x + .5) * 8, (cell.y + .5) * 8);
      }
      if (episode.kind === "REPAIR") for (const [index, worker] of workers.entries()) {
        if (economy && index) continue;
        const loaded = texture(`compact-construction-worker-${direction}-${Math.floor(now / 220 + index) % 2}`);
        if (!loaded) continue;
        worker.texture = loaded; worker.visible = true;
        const cell = episode.cells[index * 2]!; worker.position.set((cell.x + .5) * 8, (cell.y + 1) * 8);
        pixels.rect(cell.x * 8 + 2, cell.y * 8 + 2, 4, 2).fill(0x536366);
      }
      if (episode.kind !== "PATROL") for (const cell of [episode.cells[0]!, episode.cells[2]!]) {
        const x = (cell.x + .5) * 8, y = cell.y * 8;
        pixels.rect(x - 1, y, 2, 1).fill(0xe9c77c).rect(x - 2, y + 1, 4, 2).fill(0xe59043).rect(x - 3, y + 3, 6, 1).fill(0x536366);
      }
      if (episode.kind === "FIRE" || episode.kind === "ACCIDENT") {
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
