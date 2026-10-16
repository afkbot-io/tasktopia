/** Pure canonical builders share their steps between synchronous callers and
 * cancellable UI preparation. A yield is a task boundary, never RAF: hidden
 * tabs must still be able to finish or cancel their owner. */
export type CooperativePreparationOptions = {
  signal?: AbortSignal;
  yieldTask?: () => Promise<void>;
  now?: () => number;
  budgetMs?: number;
};

export function completePreparation<T>(steps: Generator<void, T, void>): T {
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

function assertActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Подготовка отменена', 'AbortError');
}

function taskScheduler() {
  let channel: MessageChannel | undefined;
  let pending: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    yieldTask: () => new Promise<void>(resolve => {
      if (typeof MessageChannel === 'undefined') {
        timer = setTimeout(() => { timer = undefined; resolve(); }, 0);
        return;
      }
      if (!channel) {
        channel = new MessageChannel();
        channel.port1.onmessage = () => { const done = pending; pending = undefined; done?.(); };
      }
      pending = resolve;
      channel.port2.postMessage(null);
    }),
    close() { channel?.port1.close(); channel?.port2.close(); if (timer !== undefined) clearTimeout(timer); pending = undefined; },
  };
}

async function pause(yieldTask: () => Promise<void>, signal?: AbortSignal): Promise<void> {
  assertActive(signal);
  if (!signal) { await yieldTask(); return; }
  await new Promise<void>((resolve, reject) => {
    let finished = false;
    const finish = (failed: boolean, error?: unknown) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener('abort', abort);
      if (failed) reject(error); else resolve();
    };
    const abort = () => finish(true, signal.reason ?? new DOMException('Подготовка отменена', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    try { Promise.resolve(yieldTask()).then(() => finish(false), error => finish(true, error)); }
    catch (error) { finish(true, error); }
  });
}

/** Explicit boundary between small canonical phases using the same owned
 * scheduler and cancellation cleanup as the incremental builders. */
export async function yieldPreparationTask(signal?: AbortSignal): Promise<void> {
  const scheduler = taskScheduler();
  try { await pause(scheduler.yieldTask, signal); assertActive(signal); }
  finally { scheduler.close(); }
}

export async function prepareCooperatively<T>(steps: Generator<void, T, void>, options: CooperativePreparationOptions = {}): Promise<T> {
  const budget = options.budgetMs ?? 4;
  if (!Number.isFinite(budget) || budget <= 0) throw new RangeError('Invalid preparation budget');
  const now = options.now ?? (() => performance.now());
  const scheduler = options.yieldTask ? undefined : taskScheduler();
  const yieldTask = options.yieldTask ?? scheduler!.yieldTask;
  let slice = now(), operations = 0, completed = false;
  try {
    for (;;) {
      assertActive(options.signal);
      const next = steps.next();
      assertActive(options.signal);
      if (next.done) { completed = true; return next.value; }
      // The operation bound also covers coarse/frozen clocks. The time budget
      // is soft by one canonical step, whose contents are deliberately small.
      if (++operations >= 8192 || now() - slice >= budget) {
        await pause(yieldTask, options.signal);
        assertActive(options.signal);
        slice = now(); operations = 0;
      }
    }
  } finally {
    if (!completed) steps.return(undefined as never);
    scheduler?.close();
  }
}

/** Stable merge order is the same as Array.sort with a pure comparator, while
 * large key sets cannot monopolise an async preparation slice. */
export function* stableSortPreparation<T>(values: Iterable<T>, compare: (a: T, b: T) => number): Generator<void, T[], void> {
  let current: T[] = [];
  for (const value of values) { current.push(value); yield; }
  // Native stable sort handles small bounded runs efficiently. A full native
  // sort would monopolise large cities; yielding every comparison instead
  // spends more time driving generators and reading the clock than sorting.
  const runSize = 256;
  for (let start = 0; start < current.length; start += runSize) {
    const run = current.slice(start, start + runSize).sort(compare);
    for (let index = 0; index < run.length; index++) current[start + index] = run[index]!;
    yield;
  }
  let target: T[] = new Array(current.length);
  for (let width = runSize; width < current.length; width *= 2) {
    for (let start = 0; start < current.length; start += width * 2) {
      const middle = Math.min(start + width, current.length), end = Math.min(start + width * 2, current.length);
      let left = start, right = middle, work = 0;
      for (let index = start; index < end; index++) {
        target[index] = right >= end || left < middle && compare(current[left]!, current[right]!) <= 0 ? current[left++]! : current[right++]!;
        // One checkpoint is at most 64 cheap comparisons. The outer scheduler
        // still checks its 4 ms budget and aborts at every checkpoint.
        if (++work === 64) { work = 0; yield; }
      }
      if (work) yield;
    }
    [current, target] = [target, current];
  }
  return current;
}
