import { BUILDING_CATALOG } from "./catalog";
import { compactFamilyMatchesFootprint } from "./compact-building-families";

/** Art backlog and stable semantic identities. Registration requires reviewed stages3–5. */
export const CITY_LANDMARKS = Object.freeze([
  { family: "compact-city-mall-v1", label: "Торговый центр «Атриум»" },
  { family: "compact-entertainment-centre-v1", label: "Кинотеатр и боулинг" },
  { family: "compact-waterpark-v1", label: "Аквапарк" },
  { family: "compact-sports-arena-v1", label: "Спортивная арена" },
  { family: "compact-covered-market-v1", label: "Крытый рынок" },
  { family: "compact-botanical-greenhouse-v1", label: "Ботаническая оранжерея" },
  { family: "compact-city-museum-v1", label: "Музей с внутренним двором" },
  { family: "compact-terrace-hotel-v1", label: "Отель с террасами" },
  { family: "compact-business-centre-v1", label: "Деловой центр" },
  { family: "compact-planetarium-v1", label: "Планетарий" },
  { family: "compact-theatre-v1", label: "Городской театр" },
  { family: "compact-concert-hall-v1", label: "Концертный зал" },
  { family: "compact-aquarium-v1", label: "Океанариум" },
  { family: "compact-exhibition-centre-v1", label: "Выставочный центр" },
  { family: "compact-central-library-v1", label: "Центральная библиотека" },
  { family: "compact-science-centre-v1", label: "Научный центр" },
  { family: "compact-observatory-v1", label: "Обсерватория" },
  { family: "compact-art-gallery-v1", label: "Художественная галерея" },
  { family: "compact-thermal-baths-v1", label: "Термальные купальни" },
  { family: "compact-ice-palace-v1", label: "Ледовый дворец" },
]);

const families = new Set(CITY_LANDMARKS.map(item => item.family));
export function isCityLandmark(family: string): boolean { return families.has(family); }

/** Unpublished concepts must never cause a missing sprite or a substituted house. */
export function cityLandmarkCandidates(width: number, height: number): string[] {
  return CITY_LANDMARKS.map(item => item.family).filter(family => {
    const entry = BUILDING_CATALOG.find(item => item.key === family);
    return entry?.maxPerCity === 1 && !entry.serviceRole && entry.category !== "HOUSE"
      && entry.tags.includes("city-landmark") && compactFamilyMatchesFootprint(family, width, height);
  }).sort();
}
