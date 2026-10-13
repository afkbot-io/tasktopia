import { describe, expect, it } from "vitest";
import {
  residentGroundPosition,
  pixelAgentPose,
  pixelAgentIsRegistered,
} from "../src/client/resident-presentation";

describe("resident presentation", () => {
  it("keeps the animal ground anchor on the centreline of every walk cell", () => {
    expect(residentGroundPosition({ x: 2, y: 3 }, { x: 3, y: 3 }, 0, 8)).toEqual({ x: 20, y: 28 });
    expect(residentGroundPosition({ x: 2, y: 3 }, { x: 3, y: 3 }, 0.5, 8)).toEqual({ x: 24, y: 28 });
    expect(residentGroundPosition({ x: 3, y: 3 }, { x: 3, y: 4 }, 1, 8)).toEqual({ x: 28, y: 36 });
  });

  it("aligns tiny sprites to screen pixels through fractional zoom and panning", () => {
    const camera = { x: -12.3, y: 7.4, scale: 1.55 };
    const pose = pixelAgentPose(20, 28, 8, 8, camera);
    expect(pose.scale * camera.scale).toBe(2);
    expect(camera.x + pose.x * camera.scale - 8).toBeCloseTo(11, 10);
    expect(camera.y + pose.y * camera.scale - 8).toBeCloseTo(43, 10);
    expect(Math.abs((pose.x - 20) * camera.scale)).toBeLessThanOrEqual(.5);
    expect(Math.abs((pose.y - 28) * camera.scale)).toBeLessThanOrEqual(.5);
    expect(pixelAgentIsRegistered(pose, 20, 28, 8, 8, camera)).toBe(true);
    // A real one-screen-pixel drift must still fail the map quality gate.
    expect(pixelAgentIsRegistered({ ...pose, x: pose.x + 1 / camera.scale }, 20, 28, 8, 8, camera)).toBe(false);
  });

  it.each([.8, 1, 1.6, 4])("keeps native screen registration at scale %s", scale => {
    const camera = { x: -33.25, y: 21.7, scale };
    const pose = pixelAgentPose(13.6, 31.1, 8, 8, camera);
    const left = camera.x + pose.x * scale - 4 * pose.scale * scale;
    const top = camera.y + pose.y * scale - 4 * pose.scale * scale;
    expect(left).toBeCloseTo(Math.round(left), 10);
    expect(top).toBeCloseTo(Math.round(top), 10);
    expect(pixelAgentIsRegistered(pose, 13.6, 31.1, 8, 8, camera)).toBe(true);
    expect(pixelAgentIsRegistered({ ...pose, scale: pose.scale * 1.1 }, 13.6, 31.1, 8, 8, camera)).toBe(false);
  });

});
