type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
type CountryCells = { cells: Array<{ x: number; y: number; width: number; height: number }> };

/** Annotation visibility follows clipped land, without relocating any geometry. */
export function visiblePlanetCountries<T extends CountryCells>(countries: readonly T[], surface: Bounds, viewport: { width: number; height: number; minX?: number; minY?: number }): T[] {
  const cx = (surface.minX + surface.maxX) / 2, cy = (surface.minY + surface.maxY) / 2;
  const rx = (surface.maxX - surface.minX) / 2, ry = (surface.maxY - surface.minY) / 2;
  if (rx <= 0 || ry <= 0) return [];
  const left = viewport.minX ?? 0, top = viewport.minY ?? 0;
  return countries.filter(country => country.cells.some(cell => {
    const minX = Math.max(left, cell.x), minY = Math.max(top, cell.y);
    const maxX = Math.min(left + viewport.width, cell.x + cell.width), maxY = Math.min(top + viewport.height, cell.y + cell.height);
    if (minX >= maxX || minY >= maxY) return false;
    const x = Math.max(minX, Math.min(maxX, cx)), y = Math.max(minY, Math.min(maxY, cy));
    return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1;
  }));
}
