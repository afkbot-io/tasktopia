type LabelInput = { id: string; x: number; y: number; width: number; height: number; offset: number; priority?: number };
type LabelPlacement = { id: string; x: number; y: number; width: number; height: number; anchor: { x: number; y: number } };

export const COUNTRY_FULL_LABEL_LIMIT = 10;
export const COUNTRY_DENSE_LABEL_LIMIT = 12;
export const COUNTRY_DENSE_LEADER_LIMIT_PX = 64;

function layoutDenseLabels(cities: readonly LabelInput[], viewport: { width: number; height: number }): LabelPlacement[] {
  const margin = 8, top = 64, bottom = 80, gap = 6;
  const placed: LabelPlacement[] = [];
  const areaBudget = viewport.width * Math.max(0, viewport.height - top - bottom) * .18;
  let occupiedArea = 0;
  const visible = cities.filter(city => city.x >= 0 && city.x <= viewport.width && city.y >= 0 && city.y <= viewport.height);
  const ordered = [...visible].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  for (const city of ordered) {
    if (placed.length >= COUNTRY_DENSE_LABEL_LIMIT) break;
    const { width, height } = city;
    if (width > viewport.width - margin * 2 || height > viewport.height - top - bottom || occupiedArea + width * height > areaBudget) continue;
    const clamp = (x: number, y: number) => ({ x: Math.max(margin + width / 2, Math.min(viewport.width - margin - width / 2, x)),
      y: Math.max(top + height / 2, Math.min(viewport.height - bottom - height / 2, y)) });
    const offset = Math.max(height / 2 + gap, Math.min(city.offset, COUNTRY_DENSE_LEADER_LIMIT_PX));
    const candidates = [clamp(city.x, city.y - offset), clamp(city.x, city.y + offset),
      clamp(city.x - width / 2 - gap, city.y), clamp(city.x + width / 2 + gap, city.y)];
    for (const x of [-1, 1]) for (const y of [-1, 1]) candidates.push(clamp(city.x + x * (width / 2 + gap), city.y + y * offset));
    const free = (point: { x: number; y: number }) => {
      const edgeX = Math.max(point.x - width / 2, Math.min(point.x + width / 2, city.x));
      const edgeY = Math.max(point.y - height / 2, Math.min(point.y + height / 2, city.y));
      return Math.hypot(edgeX - city.x, edgeY - city.y) <= COUNTRY_DENSE_LEADER_LIMIT_PX
        && !placed.some(other => Math.abs(other.x - point.x) < (other.width + width) / 2 + gap && Math.abs(other.y - point.y) < (other.height + height) / 2 + gap)
        && !visible.some(anchor => Math.abs(anchor.x - point.x) < width / 2 + 5 && Math.abs(anchor.y - point.y) < height / 2 + 5);
    };
    const point = candidates.find(free);
    // Dense maps have a complete local city directory. Never replace a missing
    // free annotation position with an overlapping or distant hit target.
    if (!point) continue;
    placed.push({ id: city.id, ...point, width, height, anchor: { x: city.x, y: city.y } });
    occupiedArea += width * height;
  }
  return placed;
}

/** Screen-space annotation packing. Geographic anchors and map data never move. */
export function layoutCountryCityLabels(cities: readonly LabelInput[], viewport: { width: number; height: number }): LabelPlacement[] {
  if (cities.length > COUNTRY_FULL_LABEL_LIMIT) return layoutDenseLabels(cities, viewport);
  const margin = 8, gap = 6, bottom = 80;
  const placed: LabelPlacement[] = [];
  for (const city of [...cities].sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id))) {
    const width = Math.min(city.width, viewport.width - margin * 2), height = city.height;
    const clamp = (x: number, y: number) => ({ x: Math.max(margin + width / 2, Math.min(viewport.width - margin - width / 2, x)),
      y: Math.max(margin + height / 2, Math.min(viewport.height - bottom - height / 2, y)) });
    const candidates = [clamp(city.x, city.y - city.offset), clamp(city.x, city.y + city.offset),
      clamp(city.x - width / 2 - 12, city.y), clamp(city.x + width / 2 + 12, city.y)];
    // Abutting an already placed card gives close free alternatives even when
    // every city's anchor falls inside the same tiny cluster.
    for (const other of placed) {
      for (const x of [other.x, other.x - (other.width + width) / 2 - gap, other.x + (other.width + width) / 2 + gap]) {
        for (const y of [other.y, other.y - (other.height + height) / 2 - gap, other.y + (other.height + height) / 2 + gap]) candidates.push(clamp(x, y));
      }
    }
    for (let y = margin + height / 2; y <= viewport.height - bottom - height / 2; y += height + gap) {
      for (let x = margin + width / 2; x <= viewport.width - margin - width / 2; x += width + gap) candidates.push({ x, y });
    }
    const free = (point: { x: number; y: number }) => !placed.some(other => Math.abs(other.x - point.x) < (other.width + width) / 2 + gap
      && Math.abs(other.y - point.y) < (other.height + height) / 2 + gap)
      && !cities.some(anchor => Math.abs(anchor.x - point.x) < width / 2 + 5 && Math.abs(anchor.y - point.y) < height / 2 + 5);
    const preferred = candidates[0]!;
    candidates.sort((a, b) => ((a.x - preferred.x) ** 2 + (a.y - preferred.y) ** 2) - ((b.x - preferred.x) ** 2 + (b.y - preferred.y) ** 2) || a.y - b.y || a.x - b.x);
    const point = candidates.find(free) ?? preferred;
    placed.push({ id: city.id, ...point, width, height, anchor: { x: city.x, y: city.y } });
  }
  return placed;
}
