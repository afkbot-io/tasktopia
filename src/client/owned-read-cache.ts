import { RevisionCache } from './map-scene-cache';

type Owner<T> = { resolve: (value: T) => void; reject: (error: unknown) => void; detach(): void };
type Pending<T> = { controller: AbortController; owners: Set<Owner<T>> };
const cancelled = () => new DOMException('Task read cancelled', 'AbortError');

/** A retained value has a separate lifetime from the consumers of pending I/O. */
export class OwnedReadCache<T> {
  private readonly retained: RevisionCache<T>;
  private readonly pending = new Map<string, Pending<T>>();
  constructor(capacity: number, private readonly pendingLimit: number, budget?: { limit: number; weight: (value: T) => number }) {
    this.retained = new RevisionCache(capacity, budget);
  }
  peek(key: string): T | undefined { return this.retained.peek(key); }
  keys(): string[] { return this.retained.keys(); }
  hasPending(key: string): boolean { return this.pending.has(key); }
  delete(key: string, reason?: Error): void {
    const entry = this.pending.get(key);
    this.pending.delete(key); this.retained.delete(key);
    entry?.controller.abort(reason);
  }
  clear(): void {
    // Session resets must not auto-retry old private scopes before React has
    // unmounted their consumers. Explicit invalidations remain retryable.
    for (const key of this.keys()) this.delete(key, new Error('Сеанс чтения задачи обновлён. Повторите попытку.'));
    this.retained.clear();
  }
  read(key: string, load: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(cancelled());
    if (this.retained.peek(key) !== undefined) return this.retained.read(key, () => Promise.reject(new Error('Missing cached task read')));
    let entry = this.pending.get(key);
    if (!entry) {
      if (this.pending.size >= this.pendingLimit) return Promise.reject(new Error('Слишком много одновременных запросов. Повторите попытку.'));
      entry = { controller: new AbortController(), owners: new Set() };
      this.pending.set(key, entry);
      const watched = entry;
      const work = this.retained.read(key, () => this.bounded(load, watched.controller));
      void work.then(value => this.finish(key, watched, owner => owner.resolve(value)), error => this.finish(key, watched, owner => owner.reject(error)));
    }
    const watched = entry;
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        if (!watched.owners.delete(owner)) return;
        owner.detach(); reject(cancelled());
        if (!watched.owners.size && this.pending.get(key) === watched) this.delete(key);
      };
      const owner: Owner<T> = { resolve, reject, detach: () => signal?.removeEventListener('abort', abort) };
      watched.owners.add(owner); signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  }
  private finish(key: string, entry: Pending<T>, settle: (owner: Owner<T>) => void) {
    if (this.pending.get(key) === entry) this.pending.delete(key);
    for (const owner of entry.owners) { owner.detach(); settle(owner); }
    entry.owners.clear();
  }
  private async bounded(load: (signal: AbortSignal) => Promise<T>, controller: AbortController): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined;
    try {
      return await Promise.race([Promise.resolve().then(() => {
        controller.signal.throwIfAborted(); return load(controller.signal);
      }), new Promise<never>((_resolve, reject) => {
        abort = () => reject(controller.signal.reason ?? cancelled()); controller.signal.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => { reject(new Error('Не удалось загрузить данные задачи. Повторите попытку.')); controller.abort(); }, 15_000);
      })]);
    } finally { clearTimeout(timer); if (abort) controller.signal.removeEventListener('abort', abort); }
  }
}

/** An invalidation can abort shared I/O before the next React revision arrives. */
export async function readTaskWithInvalidationRetry<T>(signal: AbortSignal, read: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try { return await read(); }
    catch (error) {
      if (signal.aborted) throw cancelled();
      if (!(error instanceof DOMException && error.name === 'AbortError')) throw error;
      if (attempt > 0) throw new Error('Данные задачи обновляются. Повторите попытку.', { cause: error });
    }
  }
}
