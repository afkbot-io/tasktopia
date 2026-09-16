import { readWorldPreferences } from "./world-preferences";
import { lightingAtHour, worldLighting } from "../shared/world-lighting";
let sampledSecond = Number.NaN;
const daylight = lightingAtHour(12);
let light: ReturnType<typeof worldLighting>;
/** Real civil time, shared by every map. No accumulated delta or mount epoch. */
export function readWorldLighting() {
  if (readWorldPreferences().lighting === "DAY") return daylight;
  const second = Math.floor(Date.now() / 1000);
  if (second !== sampledSecond) {
    sampledSecond = second;
    light = worldLighting(second * 1000);
  }
  return light;
}
