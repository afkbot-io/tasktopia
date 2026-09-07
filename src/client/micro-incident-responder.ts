import { microAmbientSprite } from "../shared/micro-ambient";

/** An emergency is a semantic overlay on the same native car family, not a large truck. */
export function microIncidentResponder(buildingWidthPx: number) {
  const visual = microAmbientSprite("car", "red", "west");
  const center = { x: buildingWidthPx / 2 + visual.width / 2, y: -visual.height / 2 };
  return {
    visual, center,
    beacon: { x: center.x, y: center.y - 1 },
    hose: { x: center.x - 3, y: center.y },
  };
}
