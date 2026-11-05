import { expect, it } from "vitest";
import { Graphics } from "pixi.js";
import { createEverydayView } from "../src/client/city-everyday-view";
import type { EverydayState } from "../src/client/city-everyday-controller";
import type { CityMobilityAgent } from "../src/client/city-mobility";
import { createWetCellIndex } from '../src/client/city-weather';

const idle: EverydayState = {
  visitors: [], stops: [], areaReady: false,
  rain: { phase: "DRY", intensity: 0, puddles: 0, id: "" }, sheltered: new Set(),
};
const viewport = { minX: 0, minY: 0, maxX: 20, maxY: 20 };

it("keeps an unchanged idle city scene out of Pixi's graphics update queue", () => {
  const view = createEverydayView(() => undefined, () => undefined, () => undefined);
  try {
    view.update(idle, [], 0, viewport, false);
    const graphics = view.root.children.filter((child): child is Graphics => child instanceof Graphics);
    let updates = 0;
    for (const graphic of graphics) graphic.context.on("update", () => { updates++; });
    for (let frame = 1; frame <= 120; frame++) view.update(idle, [], frame * 1000 / 60, viewport, false);
    expect(updates).toBe(0);
    expect(graphics.every(graphic => graphic.context.instructions.length === 0)).toBe(true);
  } finally { view.destroy(); }
});

it("continues drawing active pixel cues and clears their last frame exactly once", () => {
  const view = createEverydayView(() => undefined, () => undefined, () => undefined);
  const visitor: CityMobilityAgent = {
    id: "walker", kind: "WALKER", variant: "adult", current: { x: 2, y: 2 }, next: { x: 2, y: 2 },
    progress: 0, position: { x: 2.5, y: 2.5 }, direction: "south", speed: 1, steps: 0,
    activity: "REST", waitMs: 0, yieldReason: "NONE", visit: { id: "court", arrived: true },
  };
  const active: EverydayState = { ...idle, areaReady: true, visitors: [visitor], pose: {
    id: "court", kind: "SPORT", route: [{ x: 2, y: 2 }],
    area: [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 3 }, { x: 2, y: 3 }],
    start: 0, end: 5000, phase: "ACTIVITY", elapsed: 0, progress: 0,
  } };
  try {
    view.update(active, [visitor], 0, viewport, false);
    const cues = view.root.children.find((child): child is Graphics => child instanceof Graphics && child.context.instructions.length > 0)!;
    expect(cues).toBeDefined();
    let updates = 0;
    cues.context.on("update", () => { updates++; });
    view.update(active, [visitor], 1200, viewport, false);
    expect(updates).toBeGreaterThan(0);
    expect(cues.context.instructions.length).toBeGreaterThan(0);
    updates = 0;
    view.update(idle, [], 5000, viewport, false);
    expect(updates).toBe(1);
    expect(cues.context.instructions).toHaveLength(0);
    updates = 0;
    view.update(idle, [], 5016, viewport, false);
    expect(updates).toBe(0);
  } finally { view.destroy(); }
});

it("retains timed rain drawing and its transition back to a dry world", () => {
  const view = createEverydayView(() => undefined, () => undefined, () => undefined);
  const wet: EverydayState = { ...idle, rain: { id: "shower", phase: "RAIN", intensity: 0.5, puddles: 0 } };
  try {
    view.update(wet, [], 0, viewport, false);
    const weather = view.root.children.find((child): child is Graphics => child instanceof Graphics && child.context.instructions.length > 0)!;
    expect(weather).toBeDefined();
    let updates = 0;
    weather.context.on("update", () => { updates++; });
    view.update(wet, [], 120, viewport, false);
    expect(updates).toBeGreaterThan(0);
    expect(weather.context.instructions.length).toBeGreaterThan(0);
    updates = 0;
    view.update(idle, [], 240, viewport, false);
    expect(updates).toBe(1);
    expect(weather.context.instructions).toHaveLength(0);
    updates = 0;
    view.update(idle, [], 360, viewport, false);
    expect(updates).toBe(0);
  } finally { view.destroy(); }
});

it('refreshes wet ground after a paused-clock pan and reads only viewport buckets', () => {
  const view = createEverydayView(() => undefined, () => undefined, () => undefined);
  const cells = new Map<string, { x: number; y: number }>();
  for (let x = 0; x < 20_000; x++) cells.set(`${x},0`, { x, y: 0 });
  const wet: EverydayState = { ...idle, rain: { id: 'shower', phase: 'RAIN', intensity: 1, puddles: 1 } };
  try {
    view.adopt(createWetCellIndex(cells, new Map(), new Set()));
    const first = view.update(wet, [], 120, viewport, false);
    expect(first.wetCells).toBeGreaterThan(0);
    expect(first.wetVisited).toBeLessThanOrEqual(24);
    const weather = view.root.children.find((child): child is Graphics => child instanceof Graphics && child.context.instructions.length > 0)!;
    let updates = 0; weather.context.on('update', () => { updates++; });
    const pan = view.update(wet, [], 120, { minX: 1000, minY: 0, maxX: 1020, maxY: 20 }, true);
    expect(updates).toBeGreaterThan(0);
    expect(pan.wetCells).toBeGreaterThan(0);
    expect(pan.wetVisited).toBeLessThanOrEqual(24);
    expect(pan.rainStreaks).toBeLessThanOrEqual(48);
    const dry = view.update(idle, [], 240, viewport, false);
    expect(dry.wetCells).toBe(0); expect(dry.rainStreaks).toBe(0);
  } finally { view.destroy(); }
});
