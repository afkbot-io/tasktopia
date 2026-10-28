export type TaskCardFocusScope = {
  authenticationEpoch: number; sessionGeneration: number; navigationRequest: number;
  countryId: string; cityId: string; taskId: string;
};
export type ReadyTaskFocus = { id: string; countryId: string; cityId: string };
type PendingFocus = { scope: TaskCardFocusScope; apply: () => void; current: () => TaskCardFocusScope | undefined };
const matches = (a: TaskCardFocusScope, b: TaskCardFocusScope | undefined) => !!b
  && a.authenticationEpoch === b.authenticationEpoch && a.sessionGeneration === b.sessionGeneration
  && a.navigationRequest === b.navigationRequest && a.countryId === b.countryId && a.cityId === b.cityId && a.taskId === b.taskId;

/** One pending map focus; card data and its heading own the first paint. */
export class TaskCardFocus {
  private pending: PendingFocus | undefined;
  private scheduled: number | undefined;
  private disposed = false;
  constructor(private readonly frame: (callback: FrameRequestCallback) => number = callback => requestAnimationFrame(callback),
    private readonly cancelFrame: (id: number) => void = id => cancelAnimationFrame(id)) {}
  queue(scope: TaskCardFocusScope, apply: () => void, current: () => TaskCardFocusScope | undefined): void {
    this.cancel(); if (!this.disposed) this.pending = { scope: { ...scope }, apply, current };
  }
  ready(task: ReadyTaskFocus): void {
    const run = this.pending;
    if (!run || this.scheduled !== undefined || task.id !== run.scope.taskId
      || task.countryId !== run.scope.countryId || task.cityId !== run.scope.cityId) return;
    if (!matches(run.scope, run.current())) { this.cancel(); return; }
    // TaskModal calls readiness after committing the actual heading. One
    // complete frame presents it before the second frame may move the map.
    this.scheduled = this.frame(() => {
      if (this.pending !== run) return;
      this.scheduled = undefined;
      if (!matches(run.scope, run.current())) { this.cancel(); return; }
      this.scheduled = this.frame(() => {
        if (this.pending !== run) return;
        this.scheduled = undefined;
        if (!matches(run.scope, run.current())) { this.cancel(); return; }
        this.pending = undefined; run.apply();
      });
    });
  }
  cancelIfStale(): void { if (this.pending && !matches(this.pending.scope, this.pending.current())) this.cancel(); }
  cancel(): void {
    this.pending = undefined;
    if (this.scheduled !== undefined) this.cancelFrame(this.scheduled);
    this.scheduled = undefined;
  }
  dispose(): void { this.disposed = true; this.cancel(); }
}
