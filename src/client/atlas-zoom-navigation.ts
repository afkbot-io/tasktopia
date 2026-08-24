export type AtlasZoomDirection = "IN" | "OUT";
export type AtlasZoomBoundaryState = {
  direction: AtlasZoomDirection | null;
  count: number;
  lastEventAt: number;
};

export function initialAtlasZoomBoundary(): AtlasZoomBoundaryState {
  return { direction: null, count: 0, lastEventAt: 0 };
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
