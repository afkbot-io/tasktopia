import { describe, expect, it } from "vitest";
import { greenAreaPathCells } from "../src/shared/green-area";

function rectangle(width: number, height: number) {
  return Array.from({ length: width * height }, (_, index) => ({ x: index % width, y: Math.floor(index / width) }));
}

describe("green area paths", () => {
  it("uses the same perimeter and central cross for rendering and navigation", () => {
    const paths = new Set(greenAreaPathCells(rectangle(12, 10)).map((cell) => `${cell.x},${cell.y}`));
    expect(paths.has("0,5")).toBe(true);
    expect(paths.has("5,5")).toBe(true);
    expect(paths.has("8,4")).toBe(true);
    expect(paths.has("2,2")).toBe(false);
    expect(paths.has("8,7")).toBe(false);
  });

  it("keeps compact parks navigable through their perimeter without inventing a cross", () => {
    const paths = new Set(greenAreaPathCells(rectangle(5, 4)).map((cell) => `${cell.x},${cell.y}`));
    expect(paths.has("0,1")).toBe(true);
    expect(paths.has("2,1")).toBe(false);
  });
});
