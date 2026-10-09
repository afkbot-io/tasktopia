import { renderAsync } from "@resvg/resvg-js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { TaskShareLocation } from "../shared/task-share-preview";

export const escapeShareHtml = (value: string): string => value.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);
export type ShareImageData = { taskNumber: number; title: string; description: string; location: TaskShareLocation };
// Conservative one-em cells bound even wide glyphs and unbroken strings.
function lines(text: string, width: number, count: number): string[] {
  // eslint-disable-next-line no-control-regex -- strip XML-invalid controls from legacy snapshots
  const chars = Array.from(text.replace(/[\u0000-\u001f\u007f]/g, " "));
  const result: string[] = [];
  while (chars.length && result.length < count) {
    let take = Math.min(width, chars.length);
    if (chars.length > width) {
      const space = chars.slice(0, width).lastIndexOf(" ");
      if (space > width / 2) take = space;
    }
    const line = chars.splice(0, take).join("").trim();
    while (chars[0] === " ") chars.shift();
    result.push(line + (result.length === count - 1 && chars.length ? "…" : ""));
  }
  return result;
}
export function taskShareImageSvg(data: ShareImageData): string {
  const text = (value: string, x: number, y: number, size: number, color: string) =>
    `<text x="${x}" y="${y}" font-size="${size}" fill="${color}">${escapeShareHtml(value)}</text>`;
  const cells = Array.from({length: 18}, (_, i) => `<rect x="${1020 + (i % 3) * 40}" y="${80 + Math.floor(i / 3) * 40}" width="32" height="32" rx="6" fill="${["#172f26", "#2c5140", "#d9bd78"][i % 3]}"/>`).join("");
  const geography = ([['СТРАНА',data.location.country],['ГОРОД',data.location.city],['РАЙОН',data.location.district]] as const)
    .filter((entry): entry is readonly [typeof entry[0], string] => Boolean(entry[1]));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="#0b1814"/><rect x="24" y="24" width="1152" height="582" rx="24" fill="#10251d" stroke="#365647" stroke-width="1"/>
    <rect x="64" y="114" width="48" height="4" rx="2" fill="#d9bd78"/>${cells}
    <g font-family="Noto Sans">${text('TASKTOPIA',64,91,26,'#d9bd78')}${text(`ЗАДАЧА #${data.taskNumber}`,64,143,20,'#b6c6bb')}
    ${lines(data.title,22,3).map((line,i)=>text(line,64,209+i*56,42,'#f0f2e7')).join('')}
    ${lines(data.description,46,2).map((line,i)=>text(line,64,382+i*34,23,'#b6c6bb')).join('')}
    <path d="M64 450H1136" stroke="#365647"/>
    ${geography.map(([label,value],i)=>text(label,64+i*360,488,15,'#b6c6bb')+lines(value,15,2).map((line,j)=>text(line,64+i*360,522+j*29,22,'#f0f2e7')).join('')).join('')}
    </g></svg>`;
}
let rendering = 0;
export async function taskShareImage(data: ShareImageData): Promise<Buffer | null> {
  // Bounded native worker work; no external images, styles or user-controlled paths.
  if (rendering >= 2) return null;
  rendering++;
  try {
    const font = resolve(existsSync("dist/public/fonts/NotoSans-Regular.ttf") ? "dist/public/fonts/NotoSans-Regular.ttf" : "public/fonts/NotoSans-Regular.ttf");
    return (await renderAsync(taskShareImageSvg(data), {font:{fontFiles:[font],loadSystemFonts:false,defaultFontFamily:"Noto Sans"}})).asPng();
  } finally { rendering--; }
}
