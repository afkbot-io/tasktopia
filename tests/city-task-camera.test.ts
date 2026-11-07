import { describe, expect, it } from 'vitest';
import { availableMapArea, revealCameraPosition } from '../src/client/city-task-camera';

describe('task camera uses the unoccluded map at its current scale', () => {
  const screen = { x: 0, y: 0, width: 1440, height: 900 };
  it('finds the map beside the real task panel and above the bottom navigation', () => {
    expect(availableMapArea(screen, [
      { x: 804, y: 0, width: 620, height: 900 },
      { x: 500, y: 810, width: 400, height: 70 },
    ])).toEqual({ x: 0, y: 0, width: 804, height: 810 });
  });
  it('leaves a fullscreen mobile card with no usable map and ignores offscreen overlays', () => {
    expect(availableMapArea({ x: 0, y: 0, width: 390, height: 760 }, [
      { x: 0, y: -80, width: 390, height: 844 },
    ])).toBeNull();
    expect(availableMapArea(screen, [{ x: 1600, y: 0, width: 600, height: 900 }])).toEqual(screen);
  });
  it('does not move a fully visible building, even at a fractional scale', () => {
    expect(revealCameraPosition({ x: 200, y: 100 }, 1.25,
      { x: 0, y: 0, width: 48, height: 56 }, { x: 0, y: 0, width: 804, height: 810 }))
      .toEqual({ x: 200, y: 100 });
  });
  it('moves a partly covered building only enough to clear the task panel', () => {
    expect(revealCameraPosition({ x: 0, y: 0 }, 2,
      { x: 370, y: 100, width: 48, height: 56 }, { x: 0, y: 0, width: 804, height: 810 }))
      .toEqual({ x: -56, y: 0 });
  });
  it('centres an offscreen real footprint in the available area without changing zoom', () => {
    expect(revealCameraPosition({ x: 0, y: 0 }, 2,
      { x: -600, y: 1000, width: 96, height: 64 }, { x: 0, y: 0, width: 804, height: 810 }))
      .toEqual({ x: 1506, y: -1659 });
  });
  it('centres an oversized building and preserves its physical dimensions', () => {
    expect(revealCameraPosition({ x: 0, y: 0 }, 4,
      { x: 0, y: 0, width: 200, height: 200 }, { x: 0, y: 0, width: 300, height: 300 }))
      .toEqual({ x: -250, y: -250 });
  });
});
