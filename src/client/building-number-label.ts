import { BitmapFont, BitmapText, Cache, Text } from "pixi.js";
import type { BuildingBadgePresentation } from "./world-building-presentation";

const FONT = "tasktopia-building-numbers-v1";
const STYLE = { fontFamily: "Manrope, sans-serif", fontSize: 6, fontWeight: "800", fill: 0xf0f2e7 } as const;
let users = 0;

/** Shared by retained cities, released after the last renderer is disposed. */
export function retainBuildingNumberFont(): () => void {
  users++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--users === 0 && Cache.has(`${FONT}-bitmap`)) BitmapFont.uninstall(FONT);
  };
}

export function buildingNumberLabel(badge: BuildingBadgePresentation): BitmapText | Text {
  // Keep the existing fallback when the webfont has not arrived. Do not freeze
  // a system substitute in the shared atlas or block city entry on a font.
  if (!document.fonts.check("800 6px Manrope")) return new Text({ text: badge.label, resolution: 4, style: { ...STYLE, fontSize: badge.fontSize } });
  if (!Cache.has(`${FONT}-bitmap`)) BitmapFont.install({
    // 24px at resolution 1 keeps the former 6px × 4 glyph density and 8px
    // physical padding, without expanding Pixi's 512px page to 2048px.
    name: FONT, style: { ...STYLE, fontSize: STYLE.fontSize * 4 }, chars: "0123456789", resolution: 1,
    padding: 8, textureStyle: { scaleMode: "linear" },
  });
  return new BitmapText({ text: badge.label, style: { ...STYLE, fontFamily: FONT, fontSize: badge.fontSize } });
}
