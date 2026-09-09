import { expect, it } from "vitest";
import type { Graphics } from "pixi.js";
import type { ChunkTaskDto } from "../src/shared/contracts";
import { drawAirportApron } from "../src/client/airport-apron-view";

it("keeps every apron pixel inside a historical irregular airport parcel", () => {
  const footprint = Array.from({length:72}, (_, i) => ({x:i % 12,y:Math.floor(i / 12)}))
    .filter(p => !(p.x === 0 && p.y === 0));
  const task = {serviceRole:"AIRPORT",buildingType:"compact-long-gallery-v1",origin:{x:0,y:0},footprint,stage:5} as ChunkTaskDto;
  const rectangles:number[][]=[];
  const view = {rect(...args:number[]) {rectangles.push(args);return this;},fill(){return this;}};
  drawAirportApron(view as unknown as Graphics, task, 8);
  expect(rectangles.length).toBeGreaterThan(0);
  const occupied = new Set(footprint.map(p => `${p.x}:${p.y}`));
  for (const [x,y,w,h] of rectangles) for (let py=y!;py<y!+h!;py++) for (let px=x!;px<x!+w!;px++) {
    expect(occupied.has(`${Math.floor(px/8)}:${Math.floor(py/8)}`)).toBe(true);
  }
});
