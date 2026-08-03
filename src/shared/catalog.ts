import manifest from "../../assets/pixel-city-pack-v4/manifest.json";
import type { Estimate, PlatformKind } from "./contracts";

export type BuildingCategory = "HOUSE" | "HIGHRISE" | "COMMERCIAL" | "CIVIC";
export type BuildingRuleId = "STANDARD" | "UNIQUE_SERVICE" | "REQUIRES_COLLECTOR";
export type EntranceSide = "N" | "E" | "S" | "W";

export type BuildingCatalogEntry = {
  key: string;
  label: string;
  category: BuildingCategory;
  rarity: "COMMON" | "UNCOMMON" | "RARE" | "UNIQUE";
  platform: PlatformKind;
  footprint: { width: number; height: number };
  spriteSize: { width: number; height: number };
  anchor: { x: number; y: number };
  stages: string[];
  estimates: Estimate[];
  tags: string[];
  ruleIds: BuildingRuleId[];
  entrances: Array<{ side: EntranceSide; offset: number }>;
  maxPerCity?: number;
  maxPerDistrict?: number;
  serviceRole?: string;
  description: string;
};

type RawBuilding = {
  label: string;
  category: BuildingCategory;
  rarity: BuildingCatalogEntry["rarity"];
  platform: PlatformKind;
  footprintCells: [number, number];
  spriteSize: [number, number];
  anchorPx: [number, number];
  stages: string[];
  estimates: Estimate[];
  tags: string[];
  ruleIds: BuildingRuleId[];
  entrances: Array<{ side: EntranceSide; offset: number }>;
  maxPerCity: number | null;
  maxPerDistrict: number | null;
  serviceRole: string | null;
};

export const REGISTERED_BUILDING_RULES = new Set<BuildingRuleId>(["STANDARD", "UNIQUE_SERVICE", "REQUIRES_COLLECTOR"]);

export const BUILDING_CATALOG: BuildingCatalogEntry[] = Object.entries(manifest.buildings as unknown as Record<string, RawBuilding>)
  .map(([key, building]) => ({
    key,
    label: building.label,
    category: building.category,
    rarity: building.rarity,
    platform: building.platform,
    footprint: { width: building.footprintCells[0], height: building.footprintCells[1] },
    spriteSize: { width: building.spriteSize[0], height: building.spriteSize[1] },
    anchor: { x: building.anchorPx[0], y: building.anchorPx[1] },
    stages: building.stages.map((stage) => `/game-assets/v4/${stage}`),
    estimates: building.estimates,
    tags: building.tags,
    ruleIds: building.ruleIds,
    entrances: building.entrances,
    maxPerCity: building.maxPerCity ?? undefined,
    maxPerDistrict: building.maxPerDistrict ?? undefined,
    serviceRole: building.serviceRole ?? undefined,
    description: `${building.label}: объект категории ${building.category.toLowerCase()} на платформе ${building.platform.toLowerCase()}.`,
  }))
  .sort((a, b) => a.key.localeCompare(b.key));

const TASK_TAG_DICTIONARY: Array<{ tag: string; words: string[] }> = [
  { tag: "house", words: ["дом", "жиль", "квартир", "жилой", "коттедж", "таунхаус"] },
  { tag: "commercial", words: ["магазин", "торгов", "кафе", "аптек", "пекар", "заправ", "сервис"] },
  { tag: "civic", words: ["полици", "пожар", "школ", "клиник", "больниц", "банк", "почт", "мэр"] },
  { tag: "dense", words: ["офис", "высот", "башн", "комплекс", "многоэтаж"] },
];

export function inferTaskTags(title: string, description = ""): string[] {
  const value = `${title} ${description}`.toLocaleLowerCase("ru");
  return TASK_TAG_DICTIONARY.filter((entry) => entry.words.some((word) => value.includes(word))).map((entry) => entry.tag);
}

export function getBuilding(key: string): BuildingCatalogEntry {
  const building = BUILDING_CATALOG.find((entry) => entry.key === key);
  if (!building) throw new Error(`Unknown building catalog key: ${key}`);
  return building;
}

export const TERRAIN_SPRITES = manifest.terrain as Record<string, string[]>;
export type PropCatalogEntry = {
  path: string;
  size: { width: number; height: number };
  footprint: { width: number; height: number };
  anchor: { x: number; y: number };
};
type RawProp = { path: string; size: [number, number]; footprintCells: [number, number]; anchorPx: [number, number] };
export const PROP_CATALOG = Object.fromEntries(
  Object.entries(manifest.props as unknown as Record<string, RawProp>).map(([key, value]) => [key, {
    path: `/game-assets/v4/${value.path}`,
    size: { width: value.size[0], height: value.size[1] },
    footprint: { width: value.footprintCells[0], height: value.footprintCells[1] },
    anchor: { x: value.anchorPx[0], y: value.anchorPx[1] },
  }]),
) as Record<string, PropCatalogEntry>;
export const PROP_SPRITES = Object.fromEntries(
  Object.entries(PROP_CATALOG).map(([key, value]) => [key, value.path]),
) as Record<string, string>;
export const TILE_SPRITES = Object.fromEntries(
  Object.entries(manifest.tiles).map(([key, value]) => [key, `/game-assets/v4/${(value as { path: string }).path}`]),
) as Record<string, string>;

export const VEHICLE_SPRITES = Object.fromEntries(
  Object.entries(manifest.vehicles).map(([color, axes]) => [color, Object.fromEntries(
    Object.entries(axes as Record<string, { path: string }>).map(([axis, value]) => [axis, `/game-assets/v4/${value.path}?vehicle=2`]),
  )]),
) as Record<string, { vertical: string; horizontal: string }>;
