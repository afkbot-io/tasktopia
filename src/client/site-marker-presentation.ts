import type { WorldFeatureDto } from "../shared/contracts";

export type SiteMarker = NonNullable<WorldFeatureDto["siteMarker"]>;

export function siteMarkerPresentation() {
  return {
    badge: "РУИНЫ",
    heading: "Задача удалена",
    color: 0xb89a72,
    description: "От постройки остались руины и краткая история. Удалённую задачу открыть нельзя.",
  };
}

/** Site decorations never change allocation. The server owns the permanently
 * reserved rectangle; these are native construction-prop arrangements only. */
export function siteRubbleLayout(width: number, height: number, variant: SiteMarker["variant"]) {
  if (width < 16 || height < 16) return [];
  const points = variant === "brick" ? [[.25, .5], [.65, .7], [.4, .9]]
    : variant === "frame" ? [[.2, .8], [.75, .45], [.7, .85]]
    : [[.3, .75], [.65, .55]];
  return points.map(([x, y], index) => ({
    key: index === 1 ? "compact-construction-sand" : "compact-construction-bricks",
    x: Math.max(8, Math.min(width - 8, Math.round(width * x!))),
    y: Math.max(16, Math.min(height, Math.round(height * y!))),
  }));
}
