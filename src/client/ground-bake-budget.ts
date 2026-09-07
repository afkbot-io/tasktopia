export const INITIAL_GROUND_BAKE_BUDGET_MS = 4;
export const INITIAL_GROUND_BAKE_JOB_LIMIT = 3;

export type GroundBakeWork<T> = {
  /** Lower values run first; equal priorities keep FIFO. May reflect a moved camera. */
  priority?: () => number;
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
    let selected = 0;
    for (let index = 1; index < queue.length; index++) {
      if ((queue[index]!.priority?.() ?? 0) < (queue[selected]!.priority?.() ?? 0)) selected = index;
    }
    const request = queue.splice(selected, 1)[0]!;
    completed += 1;
    try { request.resolve(request.valid() ? request.task() : undefined); }
    catch (error) { request.reject(error); }
  }
  return { completed, elapsedMs: clock() - startedAt };
}
