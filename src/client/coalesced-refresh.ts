/** One request at a time, with a single trailing read for a newer event burst. */
export class CoalescedRefresh {
  private pending: Promise<void> | undefined;
  private requested = 0;
  request(work: () => Promise<void>): Promise<void> {
    this.requested += 1;
    if (this.pending) return this.pending;
    this.pending = (async () => {
      let consumed: number;
      do { consumed = this.requested; await work(); } while (consumed !== this.requested);
    })().finally(() => { this.pending = undefined; });
    return this.pending;
  }
}
