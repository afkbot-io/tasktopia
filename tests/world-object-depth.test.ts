import { describe, expect, it } from "vitest";
import { compareWorldObjects } from "../src/client/world-object-depth";

describe("world object depth", () => {
  it("orders buildings, people and traffic lights by their ground contact", () => {
    const objects = [
      { id: "building", groundY: 72, kind: "BUILDING" as const },
      { id: "walker", groundY: 64, kind: "AGENT" as const },
      { id: "signal", groundY: 56, kind: "FEATURE" as const },
    ].sort(compareWorldObjects);

    expect(objects.map((object) => object.id)).toEqual(["signal", "walker", "building"]);
  });

  it("keeps incidents in front of their building at an equal ground line", () => {
    const objects = [
      { id: "incident", groundY: 80, kind: "INCIDENT" as const },
      { id: "building", groundY: 80, kind: "BUILDING" as const },
    ].sort(compareWorldObjects);

    expect(objects.map((object) => object.id)).toEqual(["building", "incident"]);
  });
});
