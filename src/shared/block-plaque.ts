/** Inclusive number span: gaps remain discoverable through individual task labels. */
export function blockTaskRange(input: readonly number[]): string {
  const numbers = input.filter(n => Number.isSafeInteger(n) && n > 0);
  if (!numbers.length) return "";
  const min = Math.min(...numbers), max = Math.max(...numbers);
  return min === max ? String(min) : `${min}–${max}`;
}

/** Older cached scene labels may list several ranges; normalize without a world rebuild. */
export function blockPlaqueRange(label: string): string {
  return blockTaskRange(label.match(/\d+/g)?.map(Number) ?? []);
}
