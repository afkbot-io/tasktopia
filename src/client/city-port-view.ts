import type { Graphics } from "pixi.js";
import type { CityPortDto } from "../shared/city-scene-contract";

/** Integer native pixels and the city's wood/stone palette. No per-frame work. */
export function drawCityPorts(view: Graphics, ports: readonly CityPortDto[], cellSize: number): void {
  view.clear();
  for (const { stage, plan } of ports) {
    const horizontal = plan.approach.length < 2 || plan.approach[0]!.y === plan.approach[1]!.y;
    for (const p of plan.approach) {
      const x = p.x * cellSize, y = p.y * cellSize;
      if (stage === 1) { view.rect(x + 3, y + 3, 2, 2).fill(0xb1a477); continue; }
      view.rect(x + (horizontal ? 0 : 2), y + (horizontal ? 2 : 0), horizontal ? cellSize : cellSize - 4,
        horizontal ? cellSize - 4 : cellSize).fill(stage < 4 ? 0x756750 : 0x777f7b);
      view.rect(x + (horizontal ? 0 : 2), y + (horizontal ? 2 : 0), horizontal ? cellSize : 1,
        horizontal ? 1 : cellSize).fill(0x989a80);
      view.rect(x + 4, y + 4, 1, 2).fill(0x59635f);
    }
    const built = stage < 3 ? 0 : Math.ceil(plan.pier.length * (stage === 3 ? .5 : stage === 4 ? .8 : 1));
    for (const [index, p] of plan.pier.entries()) {
      const x = p.x * cellSize, y = p.y * cellSize;
      // Timber piles remain visible beneath every construction stage.
      for (const dx of [0, cellSize - 2]) {
        view.rect(x + dx, y + cellSize - 3, 2, 4).fill(0x3e493f);
        view.rect(x + dx, y + 1, 2, stage === 1 ? 2 : 4).fill(0x8c7d59);
      }
      if (index >= built) continue;
      view.rect(x, y + 1, cellSize, cellSize - 1).fill(0x4e5042);
      for (let row = 1; row < cellSize - 1; row += 2) {
        view.rect(x, y + row, cellSize, 1).fill((index + row) % 3 ? 0x938463 : 0xa3946e);
      }
      view.rect(x, y, cellSize, 1).fill(0xb0a17c);
      if (stage === 5 && index % 2 === 0) {
        view.rect(x + 1, y + 1, 2, 2).fill(0x364a44);
        view.rect(x + 1, y + 1, 2, 1).fill(0x829084);
      }
    }
  }
}
