import { describe, expect, it } from "vitest";
import { greenAreaPathCells } from "../src/shared/green-area";
import { taskParkDecorLayout } from "../src/shared/task-park";
import { TASK_PARK_VARIANTS, isTaskParkVariant, selectTaskParkVariant, taskParkSize } from "../src/shared/task-park-catalog";
import { compactTreeCover } from "../src/shared/compact-tree-placement";

const rectangle = (w: number, h: number) => Array.from({ length: w * h }, (_, i) => ({ x: i % w - 12, y: Math.floor(i / w) + 7 }));
const key = (c: { x: number; y: number }) => `${c.x},${c.y}`;
const identity = (kind: string) => kind.replace(/-stage-[345]$/, "");

describe("task-owned public spaces", () => {
  it("scales lighting with park size while keeping paths and early construction clear", () => {
    for (const [w,h,minimum] of [[6,6,2],[17,17,6]]) {
      const cells = rectangle(w!,h!);
      const lights = taskParkDecorLayout(cells,5,"urban-pocket",23).filter(p=>p.kind==="park-lamp");
      expect(lights.length).toBeGreaterThanOrEqual(minimum!);
      const paths = new Set(greenAreaPathCells(cells,"urban-pocket").map(key));
      expect(lights.every(p=>!paths.has(key(p.origin)))).toBe(true);
      expect(taskParkDecorLayout(cells,3,"urban-pocket",23).some(p=>p.kind==="park-lamp")).toBe(false);
      expect(taskParkDecorLayout(cells,4,"urban-pocket",23).filter(p=>p.kind==="park-lamp")).toEqual(lights);
    }
  });
  it("reserves projected crowns as well as trunks around paths and furniture", () => {
    for (const variant of TASK_PARK_VARIANTS) for (const [w, h] of [[6, 3], [6, 6], [17, 17]]) {
      const footprint = rectangle(w!, h!);
      const allowed = new Set(footprint.map(key));
      const paths = new Set(greenAreaPathCells(footprint, variant).map(key));
      const occupied = new Set<string>();
      for (const prop of taskParkDecorLayout(footprint, 5, variant, 81)) {
        const cover = prop.kind.startsWith("tree-") ? compactTreeCover(prop.origin)
          : Array.from({ length: prop.width * prop.height }, (_, i) => ({
            x: prop.origin.x + i % prop.width, y: prop.origin.y + Math.floor(i / prop.width),
          }));
        for (const cell of cover.map(key)) {
          expect(allowed.has(cell), `${variant}: crown outside parcel`).toBe(true);
          expect(occupied.has(cell), `${variant}: visible overlap`).toBe(false);
          if (variant !== "urban-lake") expect(paths.has(cell), `${variant}: crown over walk`).toBe(false);
          occupied.add(cell);
        }
      }
    }
  });
  it("declares pocket/block size without changing a task's business stage", () => {
    expect(taskParkSize("urban-large")).toBe("BLOCK");
    expect(taskParkSize("urban-pocket")).toBe("POCKET");
    expect(taskParkSize("urban-monument")).toBe("POCKET");
    expect(isTaskParkVariant("toString")).toBe(false);
    expect(isTaskParkVariant("urban-fountain")).toBe(true);
    const choices = Array.from({ length: 36 }, (_, i) => selectTaskParkVariant(i, 6, 3));
    expect(new Set(choices).size).toBeGreaterThanOrEqual(4);
    expect(choices).not.toContain("urban-large");
    expect(selectTaskParkVariant(18, 6, 3)).toBe(choices[18]);
  });

  it.each(["urban-fountain", "urban-monument", "urban-memorial"])("fits staged %s into a real6×3 pocket with open entrance", (variant) => {
    for (const height of [3, 4, 5, 6]) {
    const footprint = rectangle(6, height);
    const stages = ([3, 4, 5] as const).map(stage => taskParkDecorLayout(footprint, stage, variant, 23));
    for (const [index, placements] of stages.entries()) {
      const object = placements.find(p => p.kind.startsWith("compact-park-"));
      expect(object).toBeDefined();
      expect(object!.kind).toContain(`stage-${index + 3}`);
      expect({ ...object, kind: identity(object!.kind) }).toEqual({ ...stages[0]!.find(p => p.kind.startsWith("compact-park-")), kind: identity(object!.kind) });
    }
    }
  });

  it("keeps already planted objects fixed while stage4 and5 add finishing work", () => {
    for (const variant of TASK_PARK_VARIANTS) for (const [w, h] of [[6, 3], [6, 5], [17, 9], [17, 17]]) {
      const footprint = rectangle(w!, h!);
      const final = taskParkDecorLayout(footprint, 5, variant, 81);
      expect(final.length).toBeLessThanOrEqual(36);
      const allowed = new Set(footprint.map(key));
      const paths = new Set(greenAreaPathCells(footprint, variant).map(key));
      const occupied = new Set<string>();
      for (const prop of final) for (let dy = 0; dy < prop.height; dy++) for (let dx = 0; dx < prop.width; dx++) {
        const cell = key({ x: prop.origin.x + dx, y: prop.origin.y + dy });
        expect(allowed.has(cell), `${variant}: outside lot`).toBe(true);
        expect(occupied.has(cell), `${variant}: overlapping props`).toBe(false);
        // Lake furniture sits on the shoreline; all park promenades stay open.
        if (variant !== "urban-lake") expect(paths.has(cell), `${variant}: blocked path`).toBe(false);
        occupied.add(cell);
      }
      for (const stage of [3, 4] as const) for (const prop of taskParkDecorLayout(footprint, stage, variant, 81)) {
        expect(final.some(p => identity(p.kind) === identity(prop.kind) && key(p.origin) === key(prop.origin))).toBe(true);
      }
      expect(occupied.has(key({ x: -12 + Math.floor(w! / 2), y: 7 + h! - 1 }))).toBe(false);
    }
  });

  it("never places a decoration over a hole in a nonrectangular footprint", () => {
    const footprint = rectangle(17, 17).filter(c => c.x < -3 || c.y > 17);
    const allowed = new Set(footprint.map(key));
    for (const p of taskParkDecorLayout(footprint, 5, "urban-large", 1)) {
      for (let dy = 0; dy < p.height; dy++) for (let dx = 0; dx < p.width; dx++) {
        expect(allowed.has(key({ x: p.origin.x + dx, y: p.origin.y + dy }))).toBe(true);
      }
    }
  });
});
