import type { Page, TestInfo } from '@playwright/test';

/** Наблюдение не меняет callbacks, часы, кадры или порядок их выполнения. */
export async function installCityPreparationDiagnostics(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Queued = { channel: number; queued: number; delivered?: number };
    const data = { scope: 'current-document', timeOrigin: performance.timeOrigin,
      channels: [] as Array<{ id: number; stack: string }>, queue: [] as Queued[],
      states: [] as Array<Record<string, string | number | undefined>>, truncated: false };
    const NativeChannel = window.MessageChannel;
    const disposers: Array<() => void> = [];
    class ObservedChannel extends NativeChannel {
      constructor() {
        super();
        if (data.channels.length >= 64) { data.truncated = true; return; }
        const id = data.channels.length, pending: Queued[] = [];
        data.channels.push({ id, stack: (new Error().stack ?? '').slice(0, 4096) });
        const nativePost = this.port2.postMessage;
        const originalDescriptor = Object.getOwnPropertyDescriptor(this.port2, 'postMessage');
        const observedPost = new Proxy(nativePost, { apply: (target, receiver, args) => {
            const queued = performance.now();
            const result = Reflect.apply(target, receiver, args);
            if (receiver === this.port2) {
              if (data.queue.length < 4096) {
                const record: Queued = { channel: id, queued };
                data.queue.push(record); pending.push(record);
              } else data.truncated = true;
            }
            return result;
          } });
        Object.defineProperty(this.port2, 'postMessage', { configurable: true, writable: true, value: observedPost });
        const observe = () => { const record = pending.shift(); if (record) record.delivered = performance.now(); };
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
