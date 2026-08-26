import manifest from "../../assets/pixel-city-pack/manifest.json";
import type { Estimate, PlatformKind } from "./contracts";

const clientStaticOrigin = typeof window === "undefined"
  ? ""
  : String(import.meta.env.VITE_STATIC_ORIGIN ?? "").replace(/\/$/, "");
export const ASSET_REVISION = (manifest as { assetRevision?: string }).assetRevision ?? String(manifest.version);

export function gameAssetUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  const versionedPrefix = `/game-assets/v5/revisions/${ASSET_REVISION}/`;
  if (path.startsWith(versionedPrefix)) return `${clientStaticOrigin}${path}`;
  const normalized = path.startsWith("/game-assets/v5/") ? path : `/game-assets/v5/${path.replace(/^\//, "")}`;
  // Vite serves `public/` directly and does not run the production revision
  // synchronizer from server/index.ts. Point development at the live asset
  // tree so sprite-generation sessions are visible without copying a second
  // revision directory on every change. Tests and production keep asserting
  // and using immutable revision URLs.
  if (import.meta.env?.MODE === "development") return `${clientStaticOrigin}${normalized}`;
  const assetPath = normalized.slice("/game-assets/v5/".length);
  return `${clientStaticOrigin}${versionedPrefix}${assetPath}`;
}

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
  finishedPlatform?: { width: number; height: number };
  spriteSize: { width: number; height: number };
  anchor: { x: number; y: number };
  stageOpaqueBounds: Array<{ left: number; top: number; right: number; bottom: number }>;
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
  finishedPlatformCells?: [number, number];
  spriteSize: [number, number];
  anchorPx: [number, number];
  stageOpaqueBounds: Array<[number, number, number, number]>;
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
    finishedPlatform: building.finishedPlatformCells
      ? { width: building.finishedPlatformCells[0], height: building.finishedPlatformCells[1] }
      : undefined,
    spriteSize: { width: building.spriteSize[0], height: building.spriteSize[1] },
    anchor: { x: building.anchorPx[0], y: building.anchorPx[1] },
    stageOpaqueBounds: building.stageOpaqueBounds.map(([left, top, right, bottom]) => ({ left, top, right, bottom })),
    stages: building.stages.map(gameAssetUrl),
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

const CORE_CITY_SERVICE_ROLES = new Set(["health-service", "fire-service", "police-service", "parking-service"]);

/** Task-backed city catalog.
 *
 * Residential families are tiered as low-, mid- and high-rise apartment
 * complexes. The legacy PRIVATE district code selects low+mid rise, while
 * NEW_BUILD selects mid+high rise; detached private houses are not active.
 * Reviewed health, fire and police facades stay in the same
 * selector because the city audit requires them at 10/20/30 tasks. The compact
 * parking service is also task-backed so an explicitly named parking task does
 * not have to grow a residential superblock. Other categories remain
 * render-only until their task placement contract is ready.
 */
export const TASK_BUILDING_CATALOG: BuildingCatalogEntry[] = BUILDING_CATALOG
  .filter((entry) => entry.tags.includes("new-build") || entry.category === "HOUSE"
    || entry.serviceRole && CORE_CITY_SERVICE_ROLES.has(entry.serviceRole))
  .filter((entry) => !entry.tags.includes("archive"));

export function isTaskBuilding(entry: BuildingCatalogEntry): boolean {
  return TASK_BUILDING_CATALOG.some((candidate) => candidate.key === entry.key);
}

/** Every apartment family uses its catalog pavement platform. */
export function taskBuildingPlatform(entry: BuildingCatalogEntry): PlatformKind {
  return entry.tags.includes("new-build") ? "STONE" : entry.platform;
}

const TASK_TAG_DICTIONARY: Array<{ tag: string; words: string[] }> = [
  { tag: "house", words: ["дом", "жиль", "квартир", "жилой", "коттедж", "таунхаус"] },
  { tag: "commercial", words: ["магазин", "торгов", "кафе", "аптек", "пекар", "заправ", "сервис", "парков", "стоянк"] },
  { tag: "parking", words: ["парков", "стоянк"] },
  { tag: "park", words: ["парк", "сквер", "зелён", "сад отдыха", "бульвар"] },
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
    path: gameAssetUrl(value.path),
    size: { width: value.size[0], height: value.size[1] },
    footprint: { width: value.footprintCells[0], height: value.footprintCells[1] },
    anchor: { x: value.anchorPx[0], y: value.anchorPx[1] },
  }]),
) as Record<string, PropCatalogEntry>;
export const PROP_SPRITES = Object.fromEntries(
  Object.entries(PROP_CATALOG).map(([key, value]) => [key, value.path]),
) as Record<string, string>;

type RawPropAtlas = {
  path: string;
  size: [number, number];
  frames: Record<string, { x: number; y: number; width: number; height: number }>;
};
const rawPropAtlas = manifest.propAtlas as unknown as RawPropAtlas;
export const PROP_ATLAS = {
  path: gameAssetUrl(rawPropAtlas.path),
  size: { width: rawPropAtlas.size[0], height: rawPropAtlas.size[1] },
  frames: rawPropAtlas.frames,
} as const;

const ILLUMINATED_PROP_PAIRS = new Map<string, string>([
  ["streetlamp", "streetlamp-lit"],
  ["streetlamp-modern", "streetlamp-modern-lit"],
  ["streetlamp-double", "streetlamp-double-lit"],
  ["streetlamp-vintage", "streetlamp-vintage-lit"],
  ["streetlamp-solar", "streetlamp-solar-lit"],
  ["streetlamp-industrial", "streetlamp-industrial-lit"],
  ["streetlamp-festive", "streetlamp-festive-lit"],
  ["park-lamp", "park-lamp-lit"],
]);

/** Resolves a placed daytime lamp to its geometry-identical night sprite. */
export function illuminatedPropKey(key: string): string {
  return ILLUMINATED_PROP_PAIRS.get(key) ?? key;
}
export const TILE_SPRITES = Object.fromEntries(
  Object.entries(manifest.tiles).map(([key, value]) => [key, gameAssetUrl((value as { path: string }).path)]),
) as Record<string, string>;

export const VEHICLE_SPRITES = Object.fromEntries(
  Object.entries(manifest.vehicles).map(([color, axes]) => [color, Object.fromEntries(
    Object.entries(axes as Record<string, { path: string }>).map(([axis, value]) => [axis, gameAssetUrl(value.path)]),
  )]),
) as Record<string, { horizontal: string; north: string; south: string }>;
