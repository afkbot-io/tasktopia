export const INITIAL_GROUND_BAKE_BUDGET_MS = 4;
export const INITIAL_GROUND_BAKE_JOB_LIMIT = 3;

export type GroundBakeWork<T> = {
  /** Lower values run first; equal priorities keep FIFO. May reflect a moved camera. */
  priority?: () => number;
  /** A retained optional job can wait for higher-priority preparation. */
  runnable?: () => boolean;
  valid: () => boolean;
  task: () => T;
  resolve: (value: T | undefined) => void;
  reject: (error: unknown) => void;
};

/** Bound synchronous work in one animation frame. Texture generation cannot
 * be preempted, so the deadline is soft by at most one job. Initial atomic CITY
 * preparation amortizes cheap jobs; an already visible map always uses one. */
export function drainGroundBakeFrame<T>(queue: GroundBakeWork<T>[], initialAtomic: boolean,
  clock: () => number = () => performance.now()): { completed: number; elapsedMs: number } {
  const startedAt = clock();
  const limit = initialAtomic ? INITIAL_GROUND_BAKE_JOB_LIMIT : 1;
  let completed = 0;
  while (queue.length && completed < limit) {
    if (completed > 0 && clock() - startedAt >= INITIAL_GROUND_BAKE_BUDGET_MS) break;
    let selected = -1;
    for (let index = 0; index < queue.length; index++) {
      const request = queue[index]!;
      // Cancelled owners still drain and resolve. Do not inspect their state.
      if (request.runnable && request.valid() && !request.runnable()) continue;
      if (selected < 0 || (request.priority?.() ?? 0) < (queue[selected]!.priority?.() ?? 0)) selected = index;
    }
    if (selected < 0) break;
    const request = queue.splice(selected, 1)[0]!;
    completed += 1;
    try { request.resolve(request.valid() ? request.task() : undefined); }
    catch (error) { request.reject(error); }
  }
  return { completed, elapsedMs: clock() - startedAt };
}
