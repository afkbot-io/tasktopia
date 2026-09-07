import { describe, expect, it } from "vitest";
import {
  CONSTRUCTION_DETAIL_SPEC_BY_KEY,
  CONSTRUCTION_DETAIL_SPECS,
  constructionPadDepth,
  constructionStageLayout,
} from "../src/shared/construction-stage";

describe("compact construction stages", () => {
  it.each([[12, 6], [6, 12]])("keeps the complete %s×%s long-building site, access and kit in every stage", (width, height) => {
    const entrance = Math.floor(width / 2);
    for (let seed = 0; seed < 40; seed++) {
      const footprint = { width, height };
      const first = constructionStageLayout(footprint, entrance, 1, seed);
      const second = constructionStageLayout(footprint, entrance, 2, seed);
      expect(second).toEqual(constructionStageLayout(footprint, entrance, 2, seed));
      expect(second.site).toHaveLength(width * height);
      expect(new Set(second.site.map(({ x, y }) => `${x},${y}`)).size).toBe(width * height);
      expect(first.site).toEqual([]);
      expect(first.details).toEqual([]);
      const fence = [...first.rearFence, ...first.frontFence];
      expect([Math.min(...fence.map(t => t.x)), Math.max(...fence.map(t => t.x)),
        Math.min(...fence.map(t => t.y)), Math.max(...fence.map(t => t.y))]).toEqual([-1, width, -height - 1, 0]);
      expect(first.frontFence.filter(t => t.key === "compact-construction-gate").map(t => [t.x, t.y])).toEqual([
        [entrance - 1, 0], [entrance, 0],
      ]);
      for (const stage of [2, 3, 4]) {
        const layout = constructionStageLayout(footprint, entrance, stage, seed);
        expect(layout.rearFence).toEqual(first.rearFence);
        expect(layout.frontFence).toEqual(first.frontFence);
        if (stage > 2) expect([layout.site, layout.details]).toEqual([[], []]);
      }
      for (const stage of [0, 5]) {
        const layout = constructionStageLayout(footprint, entrance, stage, seed);
        expect([layout.site, layout.details, layout.rearFence, layout.frontFence]).toEqual([[], [], [], []]);
      }
      expect(second.details.map(detail => detail.key)).toEqual(expect.arrayContaining([
        "compact-construction-crane", "compact-construction-hut", "compact-construction-bricks",
      ]));
      const occupied = new Set<string>();
      for (const detail of second.details) {
        const spec = CONSTRUCTION_DETAIL_SPEC_BY_KEY[detail.key];
        const left = detail.x + (spec.footprint.width - spec.canvas.width / 8) / 2;
        const bottom = detail.y + spec.footprint.height;
        for (let y = bottom - spec.canvas.height / 8; y < bottom; y++) {
          for (let x = left; x < left + spec.canvas.width / 8; x++) {
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThan(width);
            expect(y).toBeGreaterThanOrEqual(-height);
            expect(y).toBeLessThan(0);
            expect(x >= entrance - 1 && x < entrance + 1 && y >= -2).toBe(false);
            expect(occupied.has(`${x},${y}`)).toBe(false);
            occupied.add(`${x},${y}`);
          }
        }
      }
    }
  });
  it.each([3, 4])("keeps the short 6×%s family fully equipped with one stable site on stages one–four", height => {
    for (let seed = 0; seed < 40; seed++) {
      const first = constructionStageLayout({ width: 6, height }, 3, 1, seed);
      for (const stage of [2, 3, 4]) {
        const next = constructionStageLayout({ width: 6, height }, 3, stage, seed);
        expect(next.rearFence).toEqual(first.rearFence);
        expect(next.frontFence).toEqual(first.frontFence);
        if (stage === 2) {
          expect(next.site).toHaveLength(6 * height);
          expect(next.details.map(detail => detail.key)).toEqual(expect.arrayContaining([
            "compact-construction-crane", "compact-construction-hut", "compact-construction-bricks",
          ]));
        }
      }
    }
  });
  it("reserves the whole physical site without compressing depth", () => {
    for (const size of [5, 6]) {
      expect(constructionPadDepth({ width: size, height: size })).toBe(size);
      const layout = constructionStageLayout({ width: size, height: size }, 3, 2);
      expect(layout.site).toHaveLength(size * size);
      expect(new Set(layout.site.map(({ x, y }) => `${x},${y}`)).size).toBe(size * size);
      expect(Math.min(...layout.site.map(({ y }) => y))).toBe(-size);
      expect(Math.max(...layout.site.map(({ y }) => y))).toBe(-1);
    }
  });

  it("shows only the fence on stage one and keeps the same site through stage four", () => {
    const first = constructionStageLayout({ width: 6, height: 6 }, 3, 1, 42);
    expect(first.site).toEqual([]);
    expect(first.details).toEqual([]);
    expect(first.rearFence.length).toBeGreaterThan(0);
    for (const stage of [2, 3, 4]) {
      const next = constructionStageLayout({ width: 6, height: 6 }, 3, stage, 42);
      expect(next.rearFence).toEqual(first.rearFence);
      expect(next.frontFence).toEqual(first.frontFence);
      expect(next.padDepth).toBe(first.padDepth);
      if (stage > 2) {
        expect(next.site).toEqual([]);
        expect(next.details).toEqual([]);
      }
    }
  });

  it("reserves one cell around every side and leaves the south entrance open", () => {
    const layout = constructionStageLayout({ width: 6, height: 6 }, 3, 2);
    const rear = new Set(layout.rearFence.map(({ x, y }) => `${x},${y}`));
    const front = new Set(layout.frontFence.filter(({ key }) => key === "compact-construction-fence").map(({ x, y }) => `${x},${y}`));
    expect(rear).toContain("-1,-7");
    expect(rear).toContain("6,-7");
    expect(front).not.toContain("2,0");
    expect(front).not.toContain("3,0");
    expect(layout.frontFence.filter(({ key }) => key === "compact-construction-gate")).toHaveLength(2);
    const corners = [...layout.rearFence, ...layout.frontFence].filter(({ key }) => key === "compact-construction-fence-corner");
    expect(corners).toHaveLength(4);
    expect(new Set(corners.map(({ quarterTurns }) => quarterTurns))).toEqual(new Set([0, 1, 2, 3]));
  });

  it("removes all temporary construction from planned and completed slots", () => {
    for (const stage of [0, 5]) {
      const layout = constructionStageLayout({ width: 6, height: 6 }, 3, stage);
      expect(layout.site).toEqual([]);
      expect(layout.details).toEqual([]);
      expect(layout.rearFence).toEqual([]);
      expect(layout.frontFence).toEqual([]);
    }
  });

  it("always supplies a crane, hut and material at stage two in the compact scale", () => {
    for (const size of [5, 6]) {
      for (let seed = 0; seed < 40; seed += 1) {
        const layout = constructionStageLayout({ width: size, height: size }, Math.floor(size / 2), 2, seed);
        expect(layout.details.map(({ key }) => key)).toEqual(expect.arrayContaining([
          "compact-construction-crane", "compact-construction-hut", "compact-construction-bricks",
        ]));
        expect(layout.details.length).toBeLessThanOrEqual(4);
      }
    }
    for (const spec of CONSTRUCTION_DETAIL_SPECS) {
      expect(spec.stage).toBe(2);
      expect(spec.canvas.width).toBeLessThanOrEqual(24);
      expect(spec.canvas.height).toBeLessThanOrEqual(24);
      expect(spec.footprint.width).toBeLessThanOrEqual(2);
      expect(spec.footprint.height).toBeLessThanOrEqual(2);
    }
  });

  it("keeps complete prop canvases inside the site without overlapping each other or the gate", () => {
    for (const size of [5, 6]) {
      for (const entrance of [0, Math.floor(size / 2), size - 1]) {
        for (let seed = 0; seed < 80; seed += 1) {
          const layout = constructionStageLayout({ width: size, height: size }, entrance, 2, seed);
          const gateStart = Math.max(0, Math.min(size - 2, entrance - 1));
          const occupied = new Set<string>();
          for (const detail of layout.details) {
            const spec = CONSTRUCTION_DETAIL_SPEC_BY_KEY[detail.key];
            const left = detail.x + (spec.footprint.width - spec.canvas.width / 8) / 2;
            const bottom = detail.y + spec.footprint.height;
            for (let y = bottom - spec.canvas.height / 8; y < bottom; y += 1) {
              for (let x = left; x < left + spec.canvas.width / 8; x += 1) {
                expect(x).toBeGreaterThanOrEqual(0);
                expect(x).toBeLessThan(size);
                expect(y).toBeGreaterThanOrEqual(-size);
                expect(y).toBeLessThan(0);
                expect(x >= gateStart && x < gateStart + 2 && y >= -2).toBe(false);
                const key = `${x},${y}`;
                expect(occupied.has(key), `${detail.key} overlaps ${key}`).toBe(false);
                occupied.add(key);
              }
            }
          }
        }
      }
    }
  });

  it("uses stable task-seeded compositions and varied foundation tiles", () => {
    const variants = new Set<string>();
    for (let seed = 0; seed < 10; seed += 1) {
      const first = constructionStageLayout({ width: 6, height: 6 }, 3, 2, seed);
      const repeated = constructionStageLayout({ width: 6, height: 6 }, 3, 2, seed);
      expect(first).toEqual(repeated);
      variants.add(JSON.stringify(first.details));
      expect(new Set(first.site.map(({ key }) => key)).size).toBe(3);
    }
    expect(variants.size).toBeGreaterThanOrEqual(4);
  });
});
