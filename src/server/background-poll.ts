import type { BackgroundPollStats } from "./runtime-stat-contracts";
/** A background operation owns at most one timer and one in-flight promise. */
export function startBackgroundPoll(
  operation: () => Promise<void>,
  intervalMs: number,
  onError: (error: unknown) => void,
  options: { immediate?: boolean; maxBackoffMs?: number } = {},
): { trigger(): void; close(): Promise<void>; runtimeStats(): BackgroundPollStats } {
  let closed = false;
  let active: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let requested = false;
  let failures = 0;
  let attempts = 0; let successes = 0; let errors = 0;
  let lastSuccessAt: number | null = null; let lastFailureAt: number | null = null;
  let notBefore = 0;
  const maximumBackoff = Math.max(intervalMs, options.maxBackoffMs ?? intervalMs * 32);

  const arm = (delay: number) => {
    if (closed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, Math.max(0, delay));
    timer.unref();
  };
  const run = () => {
    timer = undefined;
    if (closed || active) return;
    if (Date.now() < notBefore) { arm(notBefore - Date.now()); return; }
    requested = false;
    attempts += 1;
    active = Promise.resolve().then(operation).then(() => {
      successes += 1; lastSuccessAt = Date.now();
      failures = 0;
      notBefore = 0;
    }).catch(error => {
      failures += 1; errors += 1; lastFailureAt = Date.now();
      notBefore = Date.now() + Math.min(maximumBackoff, intervalMs * 2 ** Math.min(failures, 5));
      onError(error);
    }).finally(() => {
      active = undefined;
      arm(notBefore > Date.now() ? notBefore - Date.now() : requested ? 0 : intervalMs);
    }).catch(() => undefined); // An observer must not create an unhandled rejection.
  };

  arm(options.immediate ? 0 : intervalMs);
  return {
    runtimeStats() { return { closed, running: active !== undefined, requested, attempts, successes, errors, consecutiveFailures: failures,
      lastSuccessAt, lastFailureAt, backoffRemainingMs: Math.max(0, notBefore - Date.now()) }; },
    trigger() {
      if (closed) return;
      requested = true;
      if (!active) arm(Math.max(0, notBefore - Date.now()));
    },
    async close() {
      closed = true;
      if (timer) clearTimeout(timer);
      await active;
    },
  };
}
