import type { TaskParkVariant } from "../../src/shared/task-park-catalog";

export const COURTYARD_ART_CITY = "Город завершённых дворов";
export const COURTYARD_ART_COUNTRY = "Courtyard art QA";
export const COURTYARD_ART_FAMILIES = [
  "compact-apartment-v1", "compact-ivory-library-v1", "compact-garden-house-v1",
  "compact-rust-loft-v1", "compact-sand-balcony-v1", "compact-long-gallery-v1",
  "compact-corner-court-v1", "compact-u-courtyard-v1",
  "compact-olive-cafe-v1", "compact-rose-clinic-annex-v1", "compact-teal-mansard-v1",
  "compact-long-slate-wing-v1", "compact-plum-workshop-v1",
] as const;
export const COURTYARD_ART_PARKS = ["urban-community", "urban-formal", "urban-large"] as const satisfies readonly TaskParkVariant[];
export type CourtyardArtExample = { key: string; stage: 3 | 4 | 5; title: string; family?: string; parkVariant?: TaskParkVariant };

/** These are normal task requests; neither coordinates nor service roles are fixtures. */
export const COURTYARD_ART_PLAN: readonly CourtyardArtExample[] = ([3, 4, 5] as const).flatMap(stage => [
  ...COURTYARD_ART_FAMILIES.map(family => ({ key: `${family}-${stage}`, stage, family,
    title: `${family} · стадия ${stage}` })),
  ...COURTYARD_ART_PARKS.map(parkVariant => ({ key: `${parkVariant}-${stage}`, stage, parkVariant,
    title: `${parkVariant} · стадия ${stage}` })),
]);
/** Fixture-only cap; every addition must consume an actual public service reservation. */
export const COURTYARD_ART_SERVICE_LIMIT = 24;
export const COURTYARD_ART_MAX_RETRIES = 3;

/** A failed initial request may consume at most three real reservations. */
export async function createCourtyardArtWithRetries<T>(
  request: () => Promise<T>, isReservationConflict: (error: unknown) => boolean,
  consumeReservation: (retry: number) => Promise<void>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await request(); } catch (error) {
      if (!isReservationConflict(error) || attempt >= COURTYARD_ART_MAX_RETRIES) throw error;
      await consumeReservation(attempt + 1);
    }
  }
}
