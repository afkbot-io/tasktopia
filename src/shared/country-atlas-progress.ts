/** Mean integer progress for one atlas district, shared by cold build and realtime patching. */
export function meanCountryAtlasProgress(items: ReadonlyArray<{ progress: number }>): number {
  if (items.length === 0) return 0;
  return Math.round(items.reduce((total, item) => total + item.progress, 0) / items.length);
}
