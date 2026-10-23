/** QA-only monotonic advance toward a server-time window. ServerWorldClock
 * intentionally slews at0.9..1.1; the caller still runs its original100ms. */
export function sceneClockStepTowardStart(now: number, next: number): number {
  if (!Number.isFinite(now) || !Number.isFinite(next)) throw new Error('Invalid server clock sample');
  return Math.max(100, Math.floor((next - now + 300) / 1.1));
}
