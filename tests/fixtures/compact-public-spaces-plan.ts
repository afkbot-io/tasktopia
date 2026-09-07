import type { TaskParkVariant } from "../../src/shared/task-park-catalog";

export type PublicSpaceExample = { stage: 3 | 4 | 5; parkVariant?: TaskParkVariant };
export const PUBLIC_SPACES_CITY_NAME = "Город общественных пространств";
export const PUBLIC_SPACES_DISTRICTS = ["Площади и фонтаны", "Сады и памятники", "Большой городской парк"] as const;
/** Deliberate requests, not coordinates: the normal allocator owns every lot. */
export const PUBLIC_SPACES_PLAN: readonly (readonly PublicSpaceExample[])[] = [
  [{ stage: 3 }, { stage: 3, parkVariant: "urban-fountain" }, { stage: 4 }, { stage: 4, parkVariant: "urban-fountain" },
    { stage: 5 }, { stage: 5, parkVariant: "urban-fountain" }, { stage: 5, parkVariant: "urban-formal" },
    { stage: 5, parkVariant: "urban-pocket" }, { stage: 5, parkVariant: "urban-community" }, { stage: 5 }],
  [{ stage: 3 }, { stage: 3, parkVariant: "urban-monument" }, { stage: 4 }, { stage: 4, parkVariant: "urban-monument" },
    { stage: 5 }, { stage: 5, parkVariant: "urban-monument" }, { stage: 5, parkVariant: "urban-central" },
    { stage: 5, parkVariant: "urban-memorial" }, { stage: 5, parkVariant: "urban-botanical" }, { stage: 4 }],
  [{ stage: 3 }, { stage: 5, parkVariant: "urban-large" }, { stage: 4 }, { stage: 5, parkVariant: "urban-orchard" },
    { stage: 5, parkVariant: "urban-promenade" }, { stage: 5, parkVariant: "urban-amusement" },
    { stage: 5, parkVariant: "urban-park" }, { stage: 5, parkVariant: "urban-lake" }, { stage: 5, parkVariant: "urban-parking" }, { stage: 5 }],
];
