export type AtlasMapLevel = "PLANET" | "COUNTRY" | "CITY";
export type AtlasTransitionPhase = "PRELOAD" | "PREPARE" | "FIRST_FRAME" | "SWAP" | "EVICT";

export type AtlasTransition = {
  id: string;
  from: AtlasMapLevel;
  to: AtlasMapLevel;
  focus: { x: number; y: number };
  startedAt: number;
  durationMs: number;
  phase: AtlasTransitionPhase;
};

export function createAtlasTransition(
  from: AtlasMapLevel,
  to: AtlasMapLevel,
  focus: { x: number; y: number },
  startedAt: number,
  durationMs = 720,
): AtlasTransition {
  return {
    id: `${from.toLowerCase()}-${to.toLowerCase()}-${Math.round(startedAt)}`,
    from,
    to,
    focus: {
      x: Math.max(0, Math.min(1, focus.x)),
      y: Math.max(0, Math.min(1, focus.y)),
    },
    startedAt,
    durationMs: Math.max(120, Math.min(1_200, durationMs)),
    phase: "PRELOAD",
  };
}

export function withAtlasTransitionPhase(transition: AtlasTransition, phase: AtlasTransitionPhase): AtlasTransition {
  return { ...transition, phase };
}

export function atlasTransitionProgress(transition: AtlasTransition, now: number): number {
  return Math.max(0, Math.min(1, (now - transition.startedAt) / transition.durationMs));
}
