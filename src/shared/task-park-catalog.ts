/** Public task variants, not separate decorations or automatically created work. */
export const TASK_PARK_VARIANTS = [
  "urban-formal", "urban-community", "urban-central", "urban-botanical", "urban-amusement", "urban-park",
  "urban-lake", "urban-parking", "urban-pocket", "urban-large", "urban-fountain", "urban-monument",
  "urban-memorial", "urban-orchard", "urban-promenade",
] as const;
export type TaskParkVariant = typeof TASK_PARK_VARIANTS[number];
export const TASK_PARK_LABELS: Readonly<Record<TaskParkVariant, string>> = {
  "urban-formal": "Регулярный парк", "urban-community": "Общественный парк", "urban-central": "Центральный сквер",
  "urban-botanical": "Ботанический сад", "urban-amusement": "Парк развлечений", "urban-park": "Городской парк",
  "urban-lake": "Озеро", "urban-parking": "Парковка", "urban-pocket": "Карманный сквер", "urban-large": "Большой парк",
  "urban-fountain": "Площадь с фонтаном", "urban-monument": "Площадь с памятником", "urban-memorial": "Мемориальный сад",
  "urban-orchard": "Плодовый сад", "urban-promenade": "Прогулочная аллея",
};
export function isTaskParkVariant(value: string): value is TaskParkVariant {
  return (TASK_PARK_VARIANTS as readonly string[]).includes(value);
}
export function taskParkSize(variant: string): "POCKET" | "BLOCK" | undefined {
  if (variant === "urban-large") return "BLOCK";
  return ["urban-pocket", "urban-fountain", "urban-monument", "urban-memorial", "urban-orchard", "urban-promenade"].includes(variant) ? "POCKET" : undefined;
}
/** Assigned once and persisted on the task; catalog expansion never rerolls an old park. */
export function selectTaskParkVariant(seed: number, width: number, height: number): TaskParkVariant {
  // A one-cell planted strip is still a task, but cannot promise a fountain
  // or select a POCKET variant whose explicit size contract requires6×3.
  if (width < 6 || height < 3) return "urban-park";
  const variants: readonly TaskParkVariant[] = width >= 17 && height >= 17
    ? ["urban-large", "urban-botanical", "urban-community", "urban-formal"]
    : width >= 9 && height >= 7
      ? ["urban-formal", "urban-community", "urban-central", "urban-botanical", "urban-amusement", "urban-orchard"]
      : ["urban-pocket", "urban-fountain", "urban-monument", "urban-memorial", "urban-orchard", "urban-promenade"];
  let hash = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b);
  hash = (hash ^ (hash >>> 16)) >>> 0;
  return variants[hash % variants.length]!;
}
