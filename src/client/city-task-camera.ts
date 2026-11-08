import type { CameraPosition } from './world-camera';

export type ScreenRect = { x: number; y: number; width: number; height: number };
const right = (r: ScreenRect) => r.x + r.width;
const bottom = (r: ScreenRect) => r.y + r.height;
const usable = (r: ScreenRect) => [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width >= 96 && r.height >= 96;

/** Largest usable rectangle beside the actual DOM panels, in canvas pixels. */
export function availableMapArea(screen: ScreenRect, overlays: readonly ScreenRect[]): ScreenRect | null {
  let spaces = usable(screen) ? [{ ...screen }] : [];
  for (const overlay of overlays) {
    if (![overlay.x, overlay.y, overlay.width, overlay.height].every(Number.isFinite) || overlay.width <= 0 || overlay.height <= 0) continue;
    spaces = spaces.flatMap(area => {
      const x = Math.max(area.x, overlay.x), y = Math.max(area.y, overlay.y);
      const r = Math.min(right(area), right(overlay)), b = Math.min(bottom(area), bottom(overlay));
      if (x >= r || y >= b) return [area];
      return [
        { x: area.x, y: area.y, width: x - area.x, height: area.height },
        { x: r, y: area.y, width: right(area) - r, height: area.height },
        { x: area.x, y: area.y, width: area.width, height: y - area.y },
        { x: area.x, y: b, width: area.width, height: bottom(area) - b },
      ].filter(usable);
    }).sort((a, b) => b.width * b.height - a.width * a.height).slice(0, 32);
  }
  return spaces.sort((a, b) => b.width * b.height - a.width * a.height)[0] ?? null;
}

/** Preserve zoom; keep visible art still, minimally reveal covered art and
 * centre a distant or oversized target in the remaining usable map. */
export function revealCameraPosition(position: CameraPosition, scale: number, target: ScreenRect, area: ScreenRect, padding = 24): CameraPosition {
  const inset = Math.max(0, Math.min(padding, area.width / 4, area.height / 4));
  const safe = { x: area.x + inset, y: area.y + inset, width: area.width - inset * 2, height: area.height - inset * 2 };
  const projected = { x: position.x + target.x * scale, y: position.y + target.y * scale, width: target.width * scale, height: target.height * scale };
  const distant = right(projected) <= safe.x || projected.x >= right(safe) || bottom(projected) <= safe.y || projected.y >= bottom(safe);
  const shift = (start: number, size: number, low: number, room: number) => distant || size > room
    ? low + room / 2 - start - size / 2
    : start < low ? low - start : start + size > low + room ? low + room - start - size : 0;
  return { x: position.x + shift(projected.x, projected.width, safe.x, safe.width),
    y: position.y + shift(projected.y, projected.height, safe.y, safe.height) };
}
