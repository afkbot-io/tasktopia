import type { Cell } from "../shared/contracts";

type PixelCamera = { x: number; y: number; scale: number };
type PixelAgentPose = { x: number; y: number; scale: number };

/** Preserve whole screen pixels while the world camera pans and zooms continuously. */
export function pixelAgentPose(x: number, y: number, width: number, height: number, camera: PixelCamera): PixelAgentPose {
  const scale = Math.max(1, Math.round(camera.scale));
  const left = Math.round(camera.x + x * camera.scale - width * scale / 2);
  const top = Math.round(camera.y + y * camera.scale - height * scale / 2);
  return {
    x: (left + width * scale / 2 - camera.x) / camera.scale,
    y: (top + height * scale / 2 - camera.y) / camera.scale,
    scale: scale / camera.scale,
  };
}

/** Compare the rendered pose to its registered screen pose, including intentional snapping. */
export function pixelAgentIsRegistered(actual: PixelAgentPose, x: number, y: number, width: number, height: number, camera: PixelCamera): boolean {
  const expected = pixelAgentPose(x, y, width, height, camera);
  return Math.abs(actual.x - expected.x) * camera.scale < .01
    && Math.abs(actual.y - expected.y) * camera.scale < .01
    && Math.abs(actual.scale - expected.scale) * camera.scale < .01;
}

/** Centered ground interpolation for static-pose animals; pedestrians use their mobility path position. */
export function residentGroundPosition(
  current: Cell,
  next: Cell,
  progress: number,
  cellSize: number,
): { x: number; y: number } {
  const clamped = Math.max(0, Math.min(1, progress));
  return {
    x: (current.x + (next.x - current.x) * clamped) * cellSize + cellSize / 2,
    y: (current.y + (next.y - current.y) * clamped) * cellSize + cellSize / 2,
  };
}
