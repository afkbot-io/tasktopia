export type RuntimeShutdownStep = { name: string; close(): void | Promise<void> };
export type RuntimeShutdownResult = { status: "closed" | "failed" | "deadline"; exitCode: 0 | 1; failures: number };
export type RuntimeShutdownOptions = { drain: readonly RuntimeShutdownStep[]; release: readonly RuntimeShutdownStep[];
  deadlineMs?: number; onError?: (name: string, error: unknown) => void;
  terminate: (exitCode: 0 | 1, result: RuntimeShutdownResult) => void };

export function createRuntimeShutdown(options: RuntimeShutdownOptions) {
  const deadlineMs = options.deadlineMs ?? 30_000;
  if (!Number.isFinite(deadlineMs) || deadlineMs < 1 || deadlineMs > 120_000) throw new Error("Invalid shutdown deadline");
  let active: Promise<RuntimeShutdownResult> | undefined;
  return {
    get closing() { return active !== undefined; },
    close(): Promise<RuntimeShutdownResult> {
      if (active) return active;
      active = new Promise(resolve => {
        let finished = false, failures = 0;
        const report = (name: string, error: unknown) => {
          failures++;
          try { options.onError?.(name, error); } catch { /* A logging failure must not reject the drain. */ }
        };
        const finish = (status: RuntimeShutdownResult["status"]) => {
          if (finished) return;
          finished = true; clearTimeout(timer);
          const result: RuntimeShutdownResult = { status, exitCode: status === "closed" ? 0 : 1, failures };
          resolve(result);
          try { options.terminate(result.exitCode, result); } catch (error) { report("terminate", error); }
        };
        // Keep this timer referenced: an unresolved Promise alone does not keep
        // Node alive. Deadline is a terminal process path, not SQL cancellation.
        const timer = setTimeout(() => finish("deadline"), deadlineMs);
        const run = async (step: RuntimeShutdownStep) => {
          try { await step.close(); } catch (error) { report(step.name, error); }
        };
        // Publish `active` before user callbacks can re-enter close(). Each
        // phase starts every close before waiting on any individual operation.
        void Promise.resolve().then(async () => {
          await Promise.all(options.drain.map(run));
          if (finished) return;
          await Promise.all(options.release.map(run));
          if (!finished) finish(failures ? "failed" : "closed");
        }).catch(error => { report("shutdown", error); finish("failed"); });
      });
      return active;
    },
  };
}
