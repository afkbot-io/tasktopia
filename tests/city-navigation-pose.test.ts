import { expect, it } from 'vitest';
import { acceptsCityNavigationPose } from '../src/client/city-navigation-pose';
it('accepts current explicit camera changes and rejects late old renderer/session cleanup', () => {
  expect(acceptsCityNavigationPose(1, undefined, 1, undefined)).toBe(true);
  expect(acceptsCityNavigationPose(1, undefined, 1, 4)).toBe(false);
  expect(acceptsCityNavigationPose(1, 3, 1, 4)).toBe(false);
  expect(acceptsCityNavigationPose(1, 4, 1, 4)).toBe(true);
  expect(acceptsCityNavigationPose(1, 4, 2, 4)).toBe(false);
});
