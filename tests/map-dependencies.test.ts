import { expect, it } from "vitest";
import { dependencySegments } from "../src/client/map-dependencies";
it("draws only selected-task edges to available canonical footprints", () => {
  const tasks = new Map([["a", { footprint: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }], ["b", { footprint: [{ x: 8, y: 2 }] }]]);
  expect(dependencySegments(undefined, tasks)).toEqual([]);
  expect(dependencySegments({ sourceId: "missing", targetIds: ["b"] }, tasks)).toEqual([]);
  expect(dependencySegments({ sourceId: "a", targetIds: ["b", "b", "a", "remote"] }, tasks)).toEqual([{ id: "b", source: { x: 1, y: .5 }, target: { x: 8.5, y: 2.5 } }]);
});
