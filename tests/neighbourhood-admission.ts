export const NEIGHBOURHOOD_IDLE_WORLD_MS = 12_000;
// Existing everyday ownership lasts44s. Allow its2s admission retry, then
// the original12s idle bound; repeated owners cannot move this ceiling.
export const NEIGHBOURHOOD_ADMISSION_WORLD_MS = 44_000 + 2_000 + NEIGHBOURHOOD_IDLE_WORLD_MS;

/** The public clock must keep advancing through an observed blocking lease.
 * An absolute ceiling prevents repeated owners from extending observation. */
export function neighbourhoodAdmissionDeadline(startedAt: number, blockingUntil = startedAt): number {
  if (!Number.isFinite(startedAt) || !Number.isFinite(blockingUntil)) throw new Error('Admission clock must be finite');
  return Math.min(startedAt + NEIGHBOURHOOD_ADMISSION_WORLD_MS,
    Math.max(startedAt, blockingUntil) + NEIGHBOURHOOD_IDLE_WORLD_MS);
}
