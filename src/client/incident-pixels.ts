import type { IncidentMode } from "./task-incidents";

export type IncidentPixel = { x: number; y: number; color: number };
export const INCIDENT_FRAME_MS = 240;

// Native code-authored effects use the same flat, hard-edged raster vocabulary
// as terrain/road materials. These are not scaled legacy PNGs or building art.
const COLORS: Record<string, number> = {
  r: 0xb75638, o: 0xe59043, y: 0xe9c77c,
  d: 0x536366, s: 0x81928c, l: 0xaeb7a0,
};
const FIRE = [
  ["  o  ", " oy  ", "royor", "royor", " ror "],
  [" o   ", " yo  ", "oyoor", "royor", " ror "],
] as const;
const SMOKE = [
  [" ss  ", "slls ", " ssd ", "  dd ", "  d  "],
  ["  ss ", " slls", " dss ", " dd  ", "  d  "],
] as const;

export function incidentEffectPixels(kind: "flame" | "smoke", frame: number): IncidentPixel[] {
  const rows = (kind === "flame" ? FIRE : SMOKE)[Math.abs(frame) % 2]!;
  return rows.flatMap((row, y) => [...row].flatMap((key, x) => key === " " ? [] : [{ x: x - 2, y: y - 5, color: COLORS[key]! }]));
}

export function incidentBadge(mode: Exclude<IncidentMode, "NONE">): { label: string; color: number; pixels: IncidentPixel[] } {
  const verifying = mode === "DEFECT_VERIFYING" || mode === "HOTFIX_VERIFYING";
  const repairing = mode === "DEFECT_REPAIRING";
  const urgent = mode === "HOTFIX_ACTIVE" || mode === "HOTFIX_QUEUED";
  const rows = verifying ? ["    x", "   x ", "x x  ", " x   ", "     "]
    : repairing ? ["x   x", " xxx ", "  x  ", " x   ", "x    "]
    : ["  x  ", "  x  ", "  x  ", "     ", "  x  "];
  const color = verifying ? 0x8bae7a : urgent ? 0xe59043 : 0xe9c77c;
  const label = verifying ? "Проверка исправления" : repairing ? "Исправление ошибок" : urgent ? "Срочное исправление" : "Сообщено об ошибке";
  return { label, color, pixels: rows.flatMap((row, y) => [...row].flatMap((key, x) => key === "x" ? [{ x, y, color }] : [])) };
}
