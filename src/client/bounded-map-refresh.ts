/** One owner, one active request and one trailing read for a newer event burst. */
export class BoundedMapRefresh {
  private pending: { promise: Promise<void>; controller: AbortController } | undefined;
  private requested = 0;
  private disposed = false;

  constructor(private readonly timeoutMs = 20_000) {}

  request(work: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (this.disposed) return Promise.reject(new DOMException("Map owner disposed", "AbortError"));
    this.requested++;
    if (this.pending) return this.pending.promise;
    const controller = new AbortController();
    const run = { controller, promise: Promise.resolve() };
    run.promise = (async () => {
      let consumed: number;
      do {
        consumed = this.requested;
        await new Promise<void>((resolve, reject) => {
          let settled = false;
          const finish = (error?: unknown) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            controller.signal.removeEventListener("abort", aborted);
            if (error !== undefined) reject(error); else resolve();
          };
          const aborted = () => finish(new DOMException("Map refresh cancelled", "AbortError"));
          const timer = setTimeout(() => {
            finish(new Error("Карта обновляется слишком долго. Проверьте соединение и повторите попытку."));
            controller.abort();
          }, this.timeoutMs);
          controller.signal.addEventListener("abort", aborted, { once: true });
          Promise.resolve().then(() => {
            if (controller.signal.aborted) throw new DOMException("Map refresh cancelled", "AbortError");
            return work(controller.signal);
          }).then(() => finish(), finish);
        });
      } while (!controller.signal.aborted && consumed !== this.requested);
    })().finally(() => { if (this.pending === run) this.pending = undefined; });
    this.pending = run;
    return run.promise;
  }

  cancel(): void { const run = this.pending; this.pending = undefined; run?.controller.abort(); }
  dispose(): void { this.disposed = true; this.cancel(); }
}
