import { Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import type { Cell } from "../shared/contracts";
import { DISTRICT_DEVELOPMENT_LABEL, type DistrictDevelopmentPlan, type DistrictDevelopmentState } from "./district-development";

export function drawDistrictDevelopment(plan: DistrictDevelopmentPlan, state: DistrictDevelopmentState, anchor: Cell, cellSize: number, textureFor: (kind: string) => Texture | undefined, onSelect?: () => void, summary?: {title:string;line:string;detail:string}): Container {
  const group = new Container({ label: `district-development:${state}`, eventMode: "passive" });
  const posts = new Graphics({ eventMode: "none" });
  for (const prop of plan.fences) {
    const x = prop.origin.x * cellSize, y = prop.origin.y * cellSize;
    posts.rect(x, y + (prop.kind === "fence-horizontal" ? 6 : 14), 2, 2);
  }
  posts.fill(0xd4b25f);
  group.addChild(posts);
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
    const view = new Sprite(markerTexture);
    // Original size and camera; no stretch or rotation to fit a free cell.
    view.position.set(plan.marker.origin.x * cellSize, plan.marker.origin.y * cellSize);
    view.roundPixels = true;
    group.addChild(view);
  }
  const label = new Text({ text: summary ? `${summary.title}  ›\n${summary.line}\n${summary.detail}` : DISTRICT_DEVELOPMENT_LABEL[state], resolution: 2,
    style: { fontFamily: "Arial, sans-serif", fontSize: summary ? 8 : 10, lineHeight: summary ? 11 : 12, fontWeight: "700", fill: 0xf4ebc1 } });
  const plate = new Container({ eventMode: onSelect ? "static" : "none", cursor: "pointer" });
  plate.position.set(anchor.x * cellSize, anchor.y * cellSize - label.height - 8);
  const color = state === "PLANNED" ? 0x9aa995 : 0xd7b65e;
  plate.addChild(new Graphics().rect(-5, -4, label.width + 10, label.height + 8)
    .fill({ color: 0x18302c, alpha: 0.96 }).stroke({ color, width: 1 }), label);
  plate.on("pointertap", () => onSelect?.());
  group.addChild(plate);
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
