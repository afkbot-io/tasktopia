import { worldLighting } from "../shared/world-lighting";
let sampledSecond = Number.NaN;
let light: ReturnType<typeof worldLighting>;
/** Real civil time, shared by every map. No accumulated delta or mount epoch. */
export function readWorldLighting() {
  const second = Math.floor(Date.now() / 1000);
  if (second !== sampledSecond) {
    sampledSecond = second;
    light = worldLighting(second * 1000);
  }
  return light;
}
