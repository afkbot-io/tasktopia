export type City10000RequestFailure = { phase: string; path: string; error: string };
type RequestStart = { url: string; method: string; resourceType: string };
type ExitConfirmation = { planetReady: boolean; ownerInactive: boolean; navigationAbsent: boolean };
type ClassifiedFailure = City10000RequestFailure & {
  classification: "expected-owned-cancellation" | "unexpected";
  requestId: number | null; startedSeq: number | null; failedSeq: number;
  exitId: number | null; exitPhase: string | null; exitStartedSeq: number | null; exitConfirmedSeq: number | null;
};
type ManagedExit = { id: number; phase: string; startedSeq: number; confirmedSeq: number | null };
type PendingRequest = { id: number; startedSeq: number; exit?: ManagedExit };

/** Node harness evidence only; no product requests or cancellation side effects. */
export class City10000RequestCancellation<RequestKey extends object> {
  private readonly pending = new Map<RequestKey, PendingRequest>();
  private readonly exits = new Map<number, ManagedExit>();
  private readonly failures: { raw: City10000RequestFailure; request?: PendingRequest; failedSeq: number }[] = [];
  private sequence = 0;
  private requestId = 0;
  private exitId = 0;
  private readonly expectedPath: string;
  truncated = false;
  constructor(private readonly expectedUrl: string, private readonly maximumRecords = 128) {
    const target = new URL(expectedUrl);
    if (target.href !== target.origin + target.pathname || !/^\/api\/plan\/cities\/[^/]+\/districts$/.test(target.pathname)
      || !Number.isSafeInteger(maximumRecords) || maximumRecords < 1) throw new Error("Invalid owned request evidence scope");
    this.expectedPath = target.pathname;
  }
  started(request: RequestKey, value: RequestStart): void {
    const startedSeq = ++this.sequence;
    if (value.url !== this.expectedUrl || value.method !== "GET" || value.resourceType !== "fetch") return;
    if (this.pending.size >= this.maximumRecords || this.pending.has(request)) { this.truncated = true; return; }
    this.pending.set(request, { id: ++this.requestId, startedSeq });
  }
  finished(request: RequestKey): void { ++this.sequence; this.pending.delete(request); }
  beginExit(phase: string): number {
    const exit = { id: ++this.exitId, phase, startedSeq: ++this.sequence, confirmedSeq: null };
    if (this.exits.size >= this.maximumRecords) { this.truncated = true; return exit.id; }
    this.exits.set(exit.id, exit);
    // Snapshot identities before the native exit. Later CITY reads never inherit it.
    for (const request of this.pending.values()) request.exit ??= exit;
    return exit.id;
  }
  confirmExit(id: number, value: ExitConfirmation): void {
    const confirmedSeq = ++this.sequence, exit = this.exits.get(id);
    if (exit && value.planetReady === true && value.ownerInactive === true && value.navigationAbsent === true)
      exit.confirmedSeq = confirmedSeq;
  }
  failed(requestKey: RequestKey, raw: City10000RequestFailure): void {
    const request = this.pending.get(requestKey), failedSeq = ++this.sequence;
    this.pending.delete(requestKey);
    if (this.failures.length >= this.maximumRecords) { this.truncated = true; return; }
    this.failures.push({ raw: { ...raw }, request, failedSeq });
  }
  snapshot() {
    const classifiedFailures: ClassifiedFailure[] = this.failures.map(({ raw, request, failedSeq }) => {
      const exit = request?.exit;
      const expected = !this.truncated && raw.error === "net::ERR_ABORTED" && raw.path === this.expectedPath && exit?.confirmedSeq != null
        && request!.startedSeq < exit.startedSeq && exit.startedSeq < failedSeq;
      return { ...raw, classification: expected ? "expected-owned-cancellation" : "unexpected", requestId: request?.id ?? null,
        startedSeq: request?.startedSeq ?? null, failedSeq, exitId: exit?.id ?? null, exitPhase: exit?.phase ?? null,
        exitStartedSeq: exit?.startedSeq ?? null, exitConfirmedSeq: exit?.confirmedSeq ?? null };
    });
    return { expectedUrl: this.expectedUrl, classifiedFailures,
      expectedCancellations: classifiedFailures.filter(row => row.classification === "expected-owned-cancellation"),
      unexpectedFailures: classifiedFailures.filter(row => row.classification === "unexpected"), truncated: this.truncated };
  }
}
