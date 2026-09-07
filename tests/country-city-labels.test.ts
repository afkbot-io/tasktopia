import { describe, expect, it } from "vitest";
import { COUNTRY_DENSE_LEADER_LIMIT_PX, layoutCountryCityLabels } from "../src/client/country-city-labels";

describe("country screen-space city labels", () => {
  it("never overlaps dense labels when a hundred city cards cannot fit on a mobile map", () => {
    const viewport = { width: 390, height: 748 };
    const input = Array.from({ length: 100 }, (_, n) => ({ id: `city-${n}`, x: 60 + n % 10 * 27,
      y: 80 + Math.floor(n / 10) * 55, width: 120, height: 44, offset: 32 }));
    const result = layoutCountryCityLabels(input, viewport);
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThanOrEqual(12);
    for (let i = 0; i < result.length; i++) for (let j = i + 1; j < result.length; j++) {
      const a = result[i]!, b = result[j]!;
      expect(Math.abs(a.x - b.x) < (a.width + b.width) / 2 + 4
        && Math.abs(a.y - b.y) < (a.height + b.height) / 2 + 4).toBe(false);
    }
  });
  it.each([{ width: 1440, height: 948 }, { width: 390, height: 748 }])("keeps dense labels local, bounded and deterministic in $width px without changing any city coordinate", viewport => {
    const input = Array.from({ length: 100 }, (_, n) => ({ id: `city-${n}`, x: 30 + n % 10 * (viewport.width - 60) / 10,
      y: 90 + Math.floor(n / 10) * (viewport.height - 190) / 10, width: 140, height: 44, offset: 90,
      priority: n === 99 ? 1 : 0 }));
    const snapshot = structuredClone(input);
    const result = layoutCountryCityLabels(input, viewport);
    expect(result[0]?.id).toBe("city-99");
    expect(layoutCountryCityLabels([...input].reverse(), viewport)).toEqual(result);
    expect(input).toEqual(snapshot);
    expect(result.reduce((sum, label) => sum + label.width * label.height, 0)).toBeLessThanOrEqual(viewport.width * (viewport.height - 144) * .18);
    for (const label of result) {
      expect(label.x - label.width / 2).toBeGreaterThanOrEqual(8);
      expect(label.x + label.width / 2).toBeLessThanOrEqual(viewport.width - 8);
      expect(label.y - label.height / 2).toBeGreaterThanOrEqual(64);
      expect(label.y + label.height / 2).toBeLessThanOrEqual(viewport.height - 80);
      const original = input.find(city => city.id === label.id)!;
      expect(label.anchor).toEqual({ x: original.x, y: original.y });
      const edgeX = Math.max(label.x - label.width / 2, Math.min(label.x + label.width / 2, label.anchor.x));
      const edgeY = Math.max(label.y - label.height / 2, Math.min(label.y + label.height / 2, label.anchor.y));
      expect(Math.hypot(edgeX - label.anchor.x, edgeY - label.anchor.y)).toBeLessThanOrEqual(COUNTRY_DENSE_LEADER_LIMIT_PX);
    }
  });
  it("does not clamp offscreen cities into an unrelated visible edge or invent a hit target when no card fits", () => {
    const input = Array.from({ length: 100 }, (_, n) => ({ id: `city-${n}`, x: n % 2 ? -1 : 391,
      y: 100, width: 140, height: 44, offset: 32 }));
    expect(layoutCountryCityLabels(input, { width: 390, height: 748 })).toEqual([]);
    expect(layoutCountryCityLabels(input.map(city => ({ ...city, x: 40, y: 40 })), { width: 100, height: 100 })).toEqual([]);
  });
  it("keeps ten clustered labels disjoint, bounded and deterministic without moving their anchors", () => {
    for (const viewport of [{ width: 1440, height: 848 }, { width: 720, height: 800 }, { width: 390, height: 800 }]) {
      const input = Array.from({ length: 10 }, (_, n) => ({ id: `city-${n}`, x: viewport.width / 2 + n % 3 * 3,
        y: viewport.height / 2 + Math.floor(n / 3) * 4, width: 120 + n % 3 * 15, height: 44, offset: 32 }));
      const snapshot = structuredClone(input);
      const result = layoutCountryCityLabels(input, viewport);
      expect(result).toHaveLength(10); expect(input).toEqual(snapshot);
      expect(layoutCountryCityLabels([...input].reverse(), viewport)).toEqual(result);
      for (const label of result) {
        expect(label.x - label.width / 2).toBeGreaterThanOrEqual(8);
        expect(label.x + label.width / 2).toBeLessThanOrEqual(viewport.width - 8);
        expect(label.y - label.height / 2).toBeGreaterThanOrEqual(8);
        expect(label.y + label.height / 2).toBeLessThanOrEqual(viewport.height - 80);
        const anchor = input.find(city => city.id === label.id)!;
        expect(label.anchor).toEqual({ x: anchor.x, y: anchor.y });
      }
      for (let i = 0; i < result.length; i++) for (let j = i + 1; j < result.length; j++) {
        const a = result[i]!, b = result[j]!;
        expect(Math.abs(a.x - b.x) < (a.width + b.width) / 2 + 4
          && Math.abs(a.y - b.y) < (a.height + b.height) / 2 + 4).toBe(false);
      }
    }
  });
});
