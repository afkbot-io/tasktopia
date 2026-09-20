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
  const cells = Array.from({length: 18}, (_, i) => `<rect x="${1020 + (i % 3) * 40}" y="${80 + Math.floor(i / 3) * 40}" width="32" height="32" fill="${["#29483e", "#426450", "#8c995c"][i % 3]}"/>`).join("");
  const geography = ([['СТРАНА',data.location.country],['ГОРОД',data.location.city],['РАЙОН',data.location.district]] as const)
    .filter((entry): entry is readonly [typeof entry[0], string] => Boolean(entry[1]));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="#0c2023"/><rect x="24" y="24" width="1152" height="582" fill="#142e2c" stroke="#526c58" stroke-width="2"/>
    <rect x="24" y="24" width="1152" height="8" fill="#d9bd65"/>${cells}
    <g font-family="Noto Sans">${text('TASKTOPIA',64,91,26,'#d9bd65')}${text(`ЗАДАЧА #${data.taskNumber}`,64,143,20,'#a6bca7')}
    ${lines(data.title,22,3).map((line,i)=>text(line,64,209+i*56,42,'#f0efdb')).join('')}
    ${lines(data.description,46,2).map((line,i)=>text(line,64,382+i*34,23,'#b9cec0')).join('')}
    <path d="M64 450H1136" stroke="#456056"/>
    ${geography.map(([label,value],i)=>text(label,64+i*360,488,15,'#a6bca7')+lines(value,15,2).map((line,j)=>text(line,64+i*360,522+j*29,22,'#eee3b0')).join('')).join('')}
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
