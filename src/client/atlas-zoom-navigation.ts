export type AtlasRect = { minX: number; minY: number; maxX: number; maxY: number };
type AtlasWheelInput = { at: number; deltaY: number };
export type AtlasWheelNavigation = ReturnType<typeof createAtlasWheelNavigation>;

/** Shared by all three levels and App capture, including renderer preload.
 * The gap recognizes a new input burst; it never delays the first transition.
 */
export function createAtlasWheelNavigation() {
  let lastAt = -Infinity;
  let direction = 0;
  let consumed = false;
  const observe = (event: AtlasWheelInput) => {
    if (!Number.isFinite(event.at) || !Number.isFinite(event.deltaY) || event.deltaY === 0) return;
    const nextDirection = Math.sign(event.deltaY);
    if (nextDirection !== direction || event.at - lastAt > 220) consumed = false;
    direction = nextDirection; lastAt = event.at;
  };
  return {
    observe,
    consume(event: AtlasWheelInput, eligible: boolean): boolean {
      observe(event);
      if (!eligible || consumed || !Number.isFinite(event.deltaY) || event.deltaY === 0) return false;
      consumed = true;
      return true;
    },
  };
}

export function atlasHitTarget<T>(point: { x: number; y: number }, targets: readonly T[], rectangles: (target: T) => readonly AtlasRect[]): T | undefined {
  return targets.find(target => rectangles(target).some(rect => point.x >= rect.minX && point.x < rect.maxX && point.y >= rect.minY && point.y < rect.maxY));
}

export function atlasPointInsideEllipse(point: { x: number; y: number }, ellipse: AtlasRect): boolean {
  const rx = Math.max(1, (ellipse.maxX - ellipse.minX) / 2);
  const ry = Math.max(1, (ellipse.maxY - ellipse.minY) / 2);
  return ((point.x - ellipse.minX - rx) / rx) ** 2 + ((point.y - ellipse.minY - ry) / ry) ** 2 <= 1;
}

/** Client pixels -> SVG xMidYMid meet coordinates, including its letterbox. */
export function atlasViewBoxPoint(point: { x: number; y: number }, viewport: AtlasRect, viewBox: { width: number; height: number }): { x: number; y: number } {
  const width = viewport.maxX - viewport.minX, height = viewport.maxY - viewport.minY;
  const scale = Math.max(.001, Math.min(width / viewBox.width, height / viewBox.height));
  return {
    x: (point.x - viewport.minX - (width - viewBox.width * scale) / 2) / scale,
    y: (point.y - viewport.minY - (height - viewBox.height * scale) / 2) / scale,
  };
}
export function continuousAtlasZoom(
  current: number,
  deltaY: number,
  bounds: { min: number; max: number },
  sensitivity = 0.0015,
): number {
  const next = current * Math.exp(-deltaY * sensitivity);
  return Math.max(bounds.min, Math.min(bounds.max, next));
}

export function atlasTargetCoverage(target: AtlasRect, viewport: AtlasRect): number {
  const viewportWidth = Math.max(1, viewport.maxX - viewport.minX);
  const viewportHeight = Math.max(1, viewport.maxY - viewport.minY);
  const width = Math.max(0, Math.min(target.maxX, viewport.maxX) - Math.max(target.minX, viewport.minX));
  const height = Math.max(0, Math.min(target.maxY, viewport.maxY) - Math.max(target.minY, viewport.minY));
  return Math.max(0, Math.min(1, Math.max(width / viewportWidth, height / viewportHeight)));
}

function rectSpan(min: number, max: number): number {
  return Math.max(1, max - min + 1);
}

export function mapAtlasFocusPoint(point: { x: number; y: number }, from: AtlasRect, to: AtlasRect): { x: number; y: number } {
  const normalizedX = Math.max(0, Math.min(1, (point.x - from.minX) / rectSpan(from.minX, from.maxX)));
  const normalizedY = Math.max(0, Math.min(1, (point.y - from.minY) / rectSpan(from.minY, from.maxY)));
  return {
    x: Math.min(to.maxX, Math.round(to.minX + normalizedX * rectSpan(to.minX, to.maxX))),
    y: Math.min(to.maxY, Math.round(to.minY + normalizedY * rectSpan(to.minY, to.maxY))),
  };
}
