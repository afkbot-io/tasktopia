type RetryState = {
  hasScene: boolean;
  sceneDirty: boolean;
  sceneDirtyMovement: boolean;
  movementFailed: boolean;
};
type RetryPlan = { kind: 'SCENE'; rebuildMovement: boolean } | { kind: 'MOVEMENT' | 'RESOURCES' };

/** Fresh authoritative data must precede rebuilding any failed local network. */
export function cityRetryPlan(state: RetryState): RetryPlan {
  if (state.hasScene && state.sceneDirty) return { kind: 'SCENE', rebuildMovement: state.sceneDirtyMovement || state.movementFailed };
  return { kind: state.movementFailed ? 'MOVEMENT' : 'RESOURCES' };
}
