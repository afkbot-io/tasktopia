import { expect, it } from 'vitest';
import { cityRetryPlan } from '../src/client/city-retry-plan';

const ready = { hasScene: true, sceneDirty: false, sceneDirtyMovement: false, movementFailed: false };

it('retries the authoritative scene before a concurrently failed movement preparation', () => {
  expect(cityRetryPlan({ ...ready, sceneDirty: true, movementFailed: true })).toEqual({ kind: 'SCENE', rebuildMovement: true });
});
it('preserves movement invalidation across repeated scene refresh failures', () => {
  expect(cityRetryPlan({ ...ready, sceneDirty: true, sceneDirtyMovement: true })).toEqual({ kind: 'SCENE', rebuildMovement: true });
  expect(cityRetryPlan({ ...ready, sceneDirty: true })).toEqual({ kind: 'SCENE', rebuildMovement: false });
});
it('uses local movement recovery only when no authoritative refresh is pending', () => {
  expect(cityRetryPlan({ ...ready, movementFailed: true })).toEqual({ kind: 'MOVEMENT' });
  expect(cityRetryPlan(ready)).toEqual({ kind: 'RESOURCES' });
  expect(cityRetryPlan({ ...ready, hasScene: false, sceneDirty: true })).toEqual({ kind: 'RESOURCES' });
});
