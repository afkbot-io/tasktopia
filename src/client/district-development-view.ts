import { Container, Graphics, Rectangle, Sprite, type Texture } from "pixi.js";
import type { Cell } from "../shared/contracts";
import type { DistrictDevelopmentPlan, DistrictDevelopmentState } from "./district-development";

export function drawDistrictDevelopment(plan: DistrictDevelopmentPlan, state: DistrictDevelopmentState, cellSize: number, textureFor: (kind: string) => Texture | undefined, onSelect?: () => void): Container {
  const group = new Container({ label: `district-development:${state}`, eventMode: "passive" });
  if (plan.fences.length) {
    const posts = new Graphics({ eventMode: "none" });
    for (const prop of plan.fences) {
      const x = prop.origin.x * cellSize, y = prop.origin.y * cellSize;
      posts.rect(x, y + (prop.kind === "fence-horizontal" ? 6 : 14), 2, 2);
    }
    posts.fill(0xd4b25f);
    group.addChild(posts);
  }
  for (const prop of plan.fences) {
    const texture = textureFor(prop.kind);
    if (!texture) continue;
    const view = new Sprite(texture);
    view.position.set(prop.origin.x * cellSize, prop.origin.y * cellSize);
    view.roundPixels = true;
    group.addChild(view);
  }
  const markerTexture = textureFor(state === "PLANNED" ? "district-development-planned" : "district-development-active");
  if (plan.marker && markerTexture) {
    const view = new Sprite({ texture: markerTexture, label: "district-development-marker",
      eventMode: onSelect ? "static" : "none", cursor: onSelect ? "pointer" : "default" });
    // Original size and camera; no stretch or rotation to fit a free cell.
    view.position.set(plan.marker.origin.x * cellSize, plan.marker.origin.y * cellSize);
    view.roundPixels = true;
    // The visual and pointer target stay inside the same reserved 2×2 cells.
    view.hitArea = new Rectangle(0, 0, cellSize * 2, cellSize * 2);
    view.on("pointertap", event => { event.stopPropagation(); onSelect?.(); });
    group.addChild(view);
  }
  // District details belong in the side panel; never anchor a floating plate
  // above the district boundary where it can cover neighbouring streets.
  return group;
}

export function drawDevelopmentEmphasis(cells: readonly Cell[], cellSize: number): Graphics {
  const graphic = new Graphics({ label: "development-emphasis", eventMode: "none" });
  const owned = new Set(cells.map(c => `${c.x}:${c.y}`));
  for (const c of cells) {
    const x = c.x * cellSize, y = c.y * cellSize;
    if (!owned.has(`${c.x}:${c.y - 1}`)) graphic.moveTo(x, y).lineTo(x + cellSize, y);
    if (!owned.has(`${c.x + 1}:${c.y}`)) graphic.moveTo(x + cellSize, y).lineTo(x + cellSize, y + cellSize);
    if (!owned.has(`${c.x}:${c.y + 1}`)) graphic.moveTo(x, y + cellSize).lineTo(x + cellSize, y + cellSize);
    if (!owned.has(`${c.x - 1}:${c.y}`)) graphic.moveTo(x, y).lineTo(x, y + cellSize);
  }
  return graphic.stroke({ color: 0xe4c86d, width: 1.5, alpha: .85 });
}
