export const CITY_MOVEMENT_DEFAULT_TIMEOUT_MS = 20_000;
export const CITY_MOVEMENT_MAX_TIMEOUT_MS = 90_000;

/** Background whole-city work only. Counts come from the complete scene;
 * foreground loading and independent life/animal owners keep their budgets. */
export function cityMovementTimeoutMs(taskCount: number, chunkCount: number): number {
  for (const count of [taskCount, chunkCount]) if (!Number.isSafeInteger(count) || count < 0)
    throw new Error("Invalid canonical city workload");
  const load = Math.max(0, Math.min(1, Math.max((taskCount - 1000) / 9000, (chunkCount - 256) / 320)));
  return CITY_MOVEMENT_DEFAULT_TIMEOUT_MS + Math.ceil((CITY_MOVEMENT_MAX_TIMEOUT_MS - CITY_MOVEMENT_DEFAULT_TIMEOUT_MS) * load);
}
