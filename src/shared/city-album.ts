import type { BlockServiceRole } from "./block-world";
export type CityDevelopmentFacts = { tasks: number; buildings: number; parks: number; completedTasks: number; occupiedBlocks: number;
  activeDistricts: number; completedDistricts: number; readyServices: { role: BlockServiceRole; count: number }[] };
export const CITY_ALBUM_EVENT_TYPES = ["city.created", "district.created", "district.activated", "district.completed", "district.deleted", "task.created", "task.deleted", "task.status_changed"] as const;
export type CityAlbumItem = { eventId: number; type: typeof CITY_ALBUM_EVENT_TYPES[number]; at: string; source: "event-with-development" | "legacy-event";
  task: { id: string; taskNumber: number; title: string; exists: boolean } | null; districtId: string | null;
  before: CityDevelopmentFacts | null; after: CityDevelopmentFacts | null };
export type CityAlbumPageDto = { kind: "city.album-page"; version: 1; countryId: string; cityId: string; items: CityAlbumItem[]; nextCursor: string | null };
