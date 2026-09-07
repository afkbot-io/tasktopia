export type WorldLightPhase = "DAY" | "DAWN" | "DUSK" | "NIGHT";
const wrap = (hour: number) => ((hour % 24) + 24) % 24;
const moscowClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Moscow", hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit",
});
export function moscowHour(timestamp: number): number {
  const parts = moscowClock.formatToParts(timestamp);
  const value = (type: string) => Number(parts.find(part => part.type === type)!.value);
  return value("hour") + value("minute") / 60 + value("second") / 3600;
}
const stops = [
  { hour: 0, rgb: [130, 148, 192], lamps: 1 },
  { hour: 6, rgb: [130, 148, 192], lamps: 1 },
  { hour: 8, rgb: [230, 189, 169], lamps: .55 },
  { hour: 10, rgb: [255, 255, 255], lamps: 0 },
  { hour: 16, rgb: [255, 255, 255], lamps: 0 },
  { hour: 17, rgb: [242, 187, 156], lamps: .45 },
  { hour: 18, rgb: [130, 148, 192], lamps: 1 },
  { hour: 24, rgb: [130, 148, 192], lamps: 1 },
] as const;

/** Continuous light, no per-object timers or dependency on simulation speed. */
export function lightingAtHour(value: number) {
  const hour = wrap(value);
  const right = stops.findIndex(stop => stop.hour > hour);
  const from = stops[right - 1]!; const to = stops[right]!;
  const t = (hour - from.hour) / (to.hour - from.hour);
  const eased = t * t * (3 - 2 * t);
  const rgb = from.rgb.map((channel, i) => Math.round(channel + (to.rgb[i]! - channel) * eased));
  const phase: WorldLightPhase = hour < 6 || hour >= 18 ? "NIGHT" : hour < 10 ? "DAWN" : hour < 16 ? "DAY" : "DUSK";
  const daylight = phase === "NIGHT" ? 0 : Math.max(0, Math.sin((hour - 6) / 12 * Math.PI));
  return { phase, tint: (rgb[0]! << 16) | (rgb[1]! << 8) | rgb[2]!,
    brightness: (rgb[0]! + rgb[1]! + rgb[2]!) / (3 * 255),
    shadowAlpha: daylight * .14, shadowOffsetX: -Math.cos((hour - 6) / 12 * Math.PI) * 3,
    lamps: from.lamps + (to.lamps - from.lamps) * eased };
}

export function worldLighting(timestamp: number) {
  return lightingAtHour(moscowHour(timestamp));
}
