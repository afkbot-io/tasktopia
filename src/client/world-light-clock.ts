import { lightingAtHour } from "../shared/world-lighting";
const daylight = lightingAtHour(12);
/** A single legible daytime policy; old hidden lighting preferences cannot darken the map. */
export function readWorldLighting() { return daylight; }
