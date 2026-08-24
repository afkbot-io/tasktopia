export type AtlasZoomDirection = "IN" | "OUT";
export type AtlasRect = { minX: number; minY: number; maxX: number; maxY: number };
export type AtlasEntryHysteresisState = { armed: boolean };
export type AtlasZoomBoundaryState = {
  direction: AtlasZoomDirection | null;
  count: number;
  lastEventAt: number;
};

export function initialAtlasZoomBoundary(): AtlasZoomBoundaryState {
  return { direction: null, count: 0, lastEventAt: 0 };
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

export function initialAtlasEntryHysteresis(): AtlasEntryHysteresisState {
  return { armed: true };
}

export function returnedParentEntryHysteresis(): AtlasEntryHysteresisState {
  return { armed: false };
}

export function advanceAtlasEntryHysteresis(
  state: AtlasEntryHysteresisState,
  event: {
    direction: AtlasZoomDirection;
    zoom: number;
    rearmZoom: number;
    coverage: number;
    enterCoverage: number;
  },
): { state: AtlasEntryHysteresisState; triggered: boolean } {
  if (!state.armed) {
    if (event.direction === "OUT" && event.zoom <= event.rearmZoom) {
      return { state: initialAtlasEntryHysteresis(), triggered: false };
    }
    return { state, triggered: false };
  }
  if (event.direction === "IN" && event.coverage >= event.enterCoverage) {
    return { state: returnedParentEntryHysteresis(), triggered: true };
  }
  return { state, triggered: false };
}

function rectSpan(min: number, max: number): number {
  return Math.max(1, max - min + 1);
}

export function mapAtlasFocusPoint(point: { x: number; y: number }, from: AtlasRect, to: AtlasRect): { x: number; y: number } {
  const normalizedX = Math.max(0, Math.min(1, (point.x - from.minX) / rectSpan(from.minX, from.maxX)));
  const normalizedY = Math.max(0, Math.min(1, (point.y - from.minY) / rectSpan(from.minY, from.maxY)));
  return {
    x: Math.round(to.minX + normalizedX * rectSpan(to.minX, to.maxX)),
    y: Math.round(to.minY + normalizedY * rectSpan(to.minY, to.maxY)),
  };
}

export function advanceAtlasZoomBoundary(
  state: AtlasZoomBoundaryState,
  event: { at: number; atBoundary: boolean; direction: AtlasZoomDirection },
  requiredSteps = 2,
  resetAfterMs = 700,
): { state: AtlasZoomBoundaryState; triggered: boolean } {
  if (!event.atBoundary) return { state: initialAtlasZoomBoundary(), triggered: false };
  const continues = state.direction === event.direction
    && event.at - state.lastEventAt <= resetAfterMs;
  const count = continues ? state.count + 1 : 1;
  if (count >= requiredSteps) return { state: initialAtlasZoomBoundary(), triggered: true };
  return {
    state: { direction: event.direction, count, lastEventAt: event.at },
    triggered: false,
  };
}
