import type { Page, TestInfo } from '@playwright/test';

/** Исходные вызовы и часы сохраняются; границы наблюдения записаны в data. */
export async function installCityPreparationDiagnostics(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Transport = 'native' | 'fallback';
    type Queued = { channel: number; transport: Transport; queued: number; delivered?: number; rejected?: number };
    const data = { scope: 'current-document', timeOrigin: performance.timeOrigin,
      channels: [] as Array<{ id: number; transport: Transport; stack: string }>, queue: [] as Queued[],
      states: [] as Array<Record<string, string | number | undefined>>, truncated: false,
      nativeSchedulerCoverage: 'unsupported' as 'unsupported' | 'observed' | 'unavailable',
      nativeSchedulerReason: undefined as string | undefined,
      nativeRejectionObservationLimit: 'Settlement handlers mark the original promise handled; absence of unhandledrejection is not evidence of absence of rejection. Use uninstrumented tests/application error events.' };
    const NativeChannel = window.MessageChannel;
    const disposers: Array<() => void> = [];
    let stopped = false;
    class ObservedChannel extends NativeChannel {
      constructor() {
        super();
        if (stopped) return;
        if (data.channels.length >= 64) { data.truncated = true; return; }
        const id = data.channels.length, pending: Queued[] = [];
        data.channels.push({ id, transport: 'fallback', stack: (new Error().stack ?? '').slice(0, 4096) });
        const nativePost = this.port2.postMessage;
        const originalDescriptor = Object.getOwnPropertyDescriptor(this.port2, 'postMessage');
        const observedPost = new Proxy(nativePost, { apply: (target, receiver, args) => {
            const queued = performance.now();
            const result = Reflect.apply(target, receiver, args);
            if (!stopped && receiver === this.port2) {
              if (data.queue.length < 4096) {
                const record: Queued = { channel: id, transport: 'fallback', queued };
                data.queue.push(record); pending.push(record);
              } else data.truncated = true;
            }
            return result;
          } });
        Object.defineProperty(this.port2, 'postMessage', { configurable: true, writable: true, value: observedPost });
        const observe = () => { if (stopped) return; const record = pending.shift(); if (record) record.delivered = performance.now(); };
        // Дополнительный listener не заменяет обработчик приложения и не вызывает start().
        this.port1.addEventListener('message', observe);
        disposers.push(() => {
          this.port1.removeEventListener('message', observe); pending.length = 0;
          if (this.port2.postMessage === observedPost) {
            if (originalDescriptor) Object.defineProperty(this.port2, 'postMessage', originalDescriptor);
            else Reflect.deleteProperty(this.port2, 'postMessage');
          }
        });
      }
    }
    window.MessageChannel = ObservedChannel;
    const scheduler = (window as unknown as { scheduler?: { yield?: (...args: unknown[]) => Promise<unknown> } }).scheduler;
    if (typeof scheduler?.yield === 'function') {
      const originalDescriptor = Object.getOwnPropertyDescriptor(scheduler, 'yield');
      const channelByStack = new Map<string, number>();
      const observedYield = new Proxy(scheduler.yield, { apply: (target, receiver, args) => {
        if (stopped) return Reflect.apply(target, receiver, args);
        const queued = performance.now();
        const result = Reflect.apply(target, receiver, args) as Promise<unknown>;
        try {
          const stack = (new Error().stack ?? '').slice(0, 4096);
          let id = channelByStack.get(stack);
          if (id === undefined) {
            if (data.channels.length >= 64) { data.truncated = true; return result; }
            id = data.channels.length;
            channelByStack.set(stack, id);
            data.channels.push({ id, transport: 'native', stack });
          }
          if (data.queue.length >= 4096) { data.truncated = true; return result; }
          const record: Queued = { channel: id, transport: 'native', queued };
          data.queue.push(record);
          const settle = (outcome: 'delivered' | 'rejected') => {
            try { if (!stopped) record[outcome] = performance.now(); } catch { /* Observation must never reject its child promise. */ }
          };
          // Return the exact native promise; observation adds settlement
          // reactions, including a handler relevant to unhandledrejection.
          void result.then(() => settle('delivered'), () => settle('rejected'));
        } catch {
          data.nativeSchedulerCoverage = 'unavailable';
          data.nativeSchedulerReason = 'yield-observation-failed';
        }
        return result;
      } });
      try {
        Object.defineProperty(scheduler, 'yield', {
          configurable: originalDescriptor?.configurable ?? true,
          enumerable: originalDescriptor?.enumerable ?? false,
          writable: originalDescriptor && 'writable' in originalDescriptor ? originalDescriptor.writable : true,
          value: observedYield,
        });
        data.nativeSchedulerCoverage = 'observed';
        disposers.push(() => {
          if (Object.getOwnPropertyDescriptor(scheduler, 'yield')?.value !== observedYield) return;
          try {
            if (originalDescriptor) Object.defineProperty(scheduler, 'yield', originalDescriptor);
            else Reflect.deleteProperty(scheduler, 'yield');
          } catch {
            data.nativeSchedulerCoverage = 'unavailable';
            data.nativeSchedulerReason = 'yield-restore-failed';
          }
        });
      } catch {
        data.nativeSchedulerCoverage = 'unavailable';
        data.nativeSchedulerReason = 'yield-property-not-observable';
      }
    }
    let signature = '';
    const observer = new MutationObserver(() => {
      const host = document.querySelector<HTMLElement>('.world-canvas'); if (!host) return;
      const d = host.dataset, state = { preparing: d.movementPreparing, ready: d.mobilityReady,
        prepareMs: d.movementPrepareMs, commits: d.movementPreparationCommits, lifePreparing: d.lifePreparing,
        loading: d.loading, canonicalPending: d.canonicalSnapshotPending, tasks: d.canonicalTaskCount,
        ambient: d.ambientAssets, groundQueue: d.groundBakeQueue, entityRebuilds: d.entityRebuilds,
        walkNetworkBuilds: d.walkNetworkBuilds, commit: d.citySceneCommit };
      const next = JSON.stringify(state); if (next === signature) return; signature = next;
      if (data.states.length < 256) data.states.push({ at: performance.now(), ...state }); else data.truncated = true;
    });
    observer.observe(document, { subtree: true, attributes: true, attributeFilter: ['data-movement-preparing',
      'data-mobility-ready', 'data-movement-prepare-ms', 'data-movement-preparation-commits', 'data-life-preparing',
      'data-loading', 'data-canonical-snapshot-pending', 'data-canonical-task-count', 'data-ambient-assets',
      'data-ground-bake-queue', 'data-entity-rebuilds', 'data-walk-network-builds', 'data-city-scene-commit'] });
    Object.assign(window, { __qaCityPreparation: { read: () => ({ ...data, capturedAt: performance.now() }), stop: () => {
      stopped = true;
      observer.disconnect(); for (const dispose of disposers) dispose();
      if (window.MessageChannel === ObservedChannel) window.MessageChannel = NativeChannel;
    } } });
  });
}

/** Только неожиданный отказ сохраняет ограниченную диагностику текущего документа. */
export async function attachCityPreparationFailure(page: Page, info: TestInfo): Promise<void> {
  if (info.status === info.expectedStatus) return;
  const read = page.evaluate(() => {
    const probe = (window as unknown as { __qaCityPreparation?: { read(): unknown; stop(): void } }).__qaCityPreparation;
    if (!probe) return { coverage: 'unavailable', reason: 'document-has-no-observer' };
    const data = probe.read(); probe.stop(); return { coverage: 'observed-subset', data };
  }).catch(() => ({ coverage: 'unavailable', reason: 'page-closed-or-unresponsive' }));
  // Диагностика не должна задерживать завершение уже зависшего сценария.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([read, new Promise(resolve => {
    timer = setTimeout(() => resolve({ coverage: 'unavailable', reason: 'diagnostics-read-timeout' }), 1000);
  })]);
  if (timer) clearTimeout(timer);
  await info.attach('city-preparation-timeline', { body: Buffer.from(JSON.stringify(result, null, 2)), contentType: 'application/json' });
}
