import type { RealtimeEvent } from '../shared/contracts';

type RealtimeReplayBaseOptions = {
  countryId: string;
  cursor: () => number;
  read: (after: number, signal: AbortSignal) => Promise<RealtimeEvent[]>;
  apply: (event: RealtimeEvent) => void;
  online: (value: boolean) => void;
  pageSize?: number;
  capacity?: number;
  timeoutMs?: number;
  retryDelayMs?: number;
};

export type RealtimeReplayOptions = RealtimeReplayBaseOptions & (
  { resynchronize: (signal: AbortSignal) => Promise<number>; commitCursor: (cursor: number) => void }
  | { resynchronize?: undefined; commitCursor?: undefined }
);

class ReplayOverflow extends Error {}

/** Own the reconnect history separately from live arrivals. */
export class RealtimeReplay {
  private buffered: RealtimeEvent[] = [];
  private replaying = true;
  private connected = false;
  private closed = false;
  private epoch = 0;
  private controller?: AbortController;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private interruptRead?: (reason: Error) => void;
  private overflow = false;
  private synchronizing = false;

  constructor(private readonly options: RealtimeReplayOptions) {}

  receive(event: RealtimeEvent): void {
    if (this.closed || event.countryId !== this.options.countryId || !Number.isSafeInteger(event.id) || event.id <= this.options.cursor()) return;
    if (!this.replaying) { this.options.apply(event); return; }
    if (this.overflow) return; // The next authoritative snapshot owns these arrivals.
    this.buffered.push(event);
    if (this.buffered.length > (this.options.capacity ?? 2_000)) {
      this.overflow = true;
      this.buffered = [];
      if (!this.synchronizing) this.interruptRead?.(new ReplayOverflow('Replay arrival budget exceeded'));
    }
  }

  async connect(): Promise<void> {
    if (this.closed) return;
    clearTimeout(this.retryTimer);
    this.controller?.abort();
    this.controller = new AbortController();
    this.synchronizing = false;
    const epoch = ++this.epoch;
    this.connected = true;
    this.replaying = true;
    this.options.online(false);
    for (let attempt = 0; attempt < 3 && this.current(epoch); attempt++) {
      try {
        this.commit(await this.history(epoch));
        return;
      } catch (error) {
        if (!this.current(epoch)) return;
        if (error instanceof ReplayOverflow || attempt === 2) break;
        await this.pause((this.options.retryDelayMs ?? 250) * (attempt + 1));
      }
    }
    if (!this.current(epoch)) return;
    try {
      if (!this.options.resynchronize) throw new Error('Authoritative recovery unavailable');
      this.synchronizing = true;
      const cursor = await this.bounded(signal => this.options.resynchronize!(signal));
      if (!this.current(epoch)) return;
      if (!Number.isSafeInteger(cursor) || cursor < this.options.cursor()) throw new Error('Invalid recovery cursor');
      this.options.commitCursor?.(cursor);
      this.buffered = this.buffered.filter(event => event.id > cursor);
      this.overflow = false;
      this.synchronizing = false;
      // The snapshot may precede a buffered arrival; read that gap before publishing it.
      this.commit(await this.history(epoch));
    } catch {
      if (!this.current(epoch)) return;
      this.options.online(false);
      this.retryTimer = setTimeout(() => { if (this.current(epoch)) void this.connect(); }, 5_000);
    } finally {
      if (this.current(epoch)) this.synchronizing = false;
    }
  }

  private current(epoch: number): boolean { return epoch === this.epoch && this.connected && !this.closed; }

  private async history(epoch: number): Promise<RealtimeEvent[]> {
    const result: RealtimeEvent[] = [];
    let cursor = this.options.cursor();
    while (this.current(epoch)) {
      if (this.overflow) throw new ReplayOverflow('Replay arrival budget exceeded');
      const page = await this.bounded(signal => this.options.read(cursor, signal));
      if (!this.current(epoch)) throw new DOMException('Replay cancelled', 'AbortError');
      if (!Array.isArray(page) || page.length > (this.options.pageSize ?? 500)) throw new Error('Invalid replay page');
      let previous = cursor;
      for (const event of page) {
        if (event.countryId !== this.options.countryId || !Number.isSafeInteger(event.id) || event.id <= previous) throw new Error('Invalid replay order or scope');
        previous = event.id;
      }
      result.push(...page);
      if (result.length > (this.options.capacity ?? 2_000)) throw new ReplayOverflow('Replay history budget exceeded');
      if (page.length < (this.options.pageSize ?? 500)) return result;
      cursor = page.at(-1)!.id;
    }
    throw new DOMException('Replay cancelled', 'AbortError');
  }

  private commit(history: RealtimeEvent[]): void {
    if (this.overflow) throw new ReplayOverflow('Replay arrival budget exceeded');
    const pending = [...history, ...this.buffered].sort((a, b) => a.id - b.id);
    this.buffered = [];
    this.replaying = false;
    for (const event of pending) if (event.id > this.options.cursor()) this.options.apply(event);
    this.options.online(true);
  }

  private bounded<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const parent = this.controller!.signal;
    const controller = new AbortController();
    return new Promise<T>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); parent.removeEventListener('abort', abort); if (this.interruptRead === fail) this.interruptRead = undefined; };
      const fail = (reason: Error) => { controller.abort(); cleanup(); reject(reason); };
      const abort = () => fail(new DOMException('Replay cancelled', 'AbortError'));
      const timer = setTimeout(() => fail(new Error('Replay read deadline exceeded')), this.options.timeoutMs ?? 20_000);
      this.interruptRead = fail;
      parent.addEventListener('abort', abort, { once: true });
      if (parent.aborted) { abort(); return; }
      Promise.resolve().then(() => {
        if (controller.signal.aborted) throw new DOMException('Replay cancelled', 'AbortError');
        return work(controller.signal);
      }).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    });
  }

  private pause(ms: number): Promise<void> {
    const signal = this.controller!.signal;
    return new Promise(resolve => {
      const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
      const timer = setTimeout(finish, ms);
      signal.addEventListener('abort', finish, { once: true });
      if (signal.aborted) finish();
    });
  }

  disconnect(): void {
    this.connected = false;
    this.replaying = true;
    this.epoch++;
    this.controller?.abort();
    clearTimeout(this.retryTimer);
    this.synchronizing = false;
    this.buffered = [];
    this.overflow = false;
    this.options.online(false);
  }

  close(): void {
    this.closed = true;
    this.disconnect();
    this.buffered = [];
  }
}
