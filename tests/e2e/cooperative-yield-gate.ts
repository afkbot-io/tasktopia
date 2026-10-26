import type { Page } from '@playwright/test';

export type CooperativeYieldGateState = {
  captured: boolean;
  held: number;
  channels: number;
  firstClosed: boolean | null;
  firstStack: string;
  transport: 'scheduler' | 'message-channel' | null;
  nativeAvailable: boolean;
};
export type CooperativeYieldGateWindow = Window & {
  qaCooperativeYield: { arm(): void; release(): void; state(): CooperativeYieldGateState };
};

/** Удерживает реально выбранную task boundary; React и другие очереди остаются нативными. */
export async function installCooperativeYieldGate(page: Page, options: {
  phase: 'movement' | 'life'; armInitially: boolean; firstOnly: boolean;
}): Promise<void> {
  await page.addInitScript(({ phase, armInitially, firstOnly }) => {
    const NativeChannel = window.MessageChannel;
    const scheduler = globalThis.scheduler;
    const originalYield = scheduler?.yield;
    const originalDescriptor = scheduler && Object.getOwnPropertyDescriptor(scheduler, 'yield');
    const nativeAvailable = typeof originalYield === 'function';
    const queued: Array<() => void> = [];
    let armed = armInitially, captured = false, holding = true, channels = 0, firstStack = '';
    let firstClosed: boolean | null = null;
    let transport: 'scheduler' | 'message-channel' | null = null;
    const eligible = (stack: string) => armed && stack.includes('yieldTask')
      && document.querySelector<HTMLElement>('.world-canvas')?.dataset[phase === 'movement' ? 'movementPreparing' : 'lifePreparing'] === 'true';
    const capture = (stack: string, mode: 'scheduler' | 'message-channel') => {
      channels++;
      if (firstOnly && captured) return false;
      if (!captured) {
        firstStack = stack.slice(0, 4096);
        transport = mode;
        firstClosed = mode === 'message-channel' ? false : null;
      }
      captured = true;
      return true;
    };
    class PendingChannel extends NativeChannel {
      constructor() {
        super();
        const stack = new Error().stack ?? '';
        if (!eligible(stack) || !capture(stack, 'message-channel')) return;
        const send = this.port2.postMessage.bind(this.port2), close = this.port1.close.bind(this.port1);
        this.port1.close = () => { firstClosed = true; close(); };
        this.port2.postMessage = ((...args: Parameters<MessagePort['postMessage']>) => {
          if (holding) queued.push(() => send(...args)); else send(...args);
        }) as MessagePort['postMessage'];
      }
    }
    window.MessageChannel = PendingChannel;
    const pendingYield = function (this: unknown, ...args: unknown[]): Promise<void> {
      const stack = new Error().stack ?? '';
      const send = () => Reflect.apply(originalYield!, this, args) as Promise<void>;
      if (this !== scheduler || !eligible(stack) || !capture(stack, 'scheduler')) return send();
      return new Promise<void>((resolve, reject) => {
        const resume = () => { try { send().then(resolve, reject); } catch (error) { reject(error); } };
        if (holding) queued.push(resume); else resume();
      });
    };
    if (nativeAvailable) Object.defineProperty(scheduler, 'yield', { configurable: true, writable: true, value: pendingYield });
    Object.assign(window, { qaCooperativeYield: {
      arm: () => { armed = true; },
      state: () => ({ captured, held: queued.length, channels, firstClosed, firstStack, transport, nativeAvailable }),
      release: () => {
        holding = false;
        for (const send of queued.splice(0)) send();
        if (window.MessageChannel === PendingChannel) window.MessageChannel = NativeChannel;
        if (nativeAvailable && scheduler.yield === pendingYield) {
          if (originalDescriptor) Object.defineProperty(scheduler, 'yield', originalDescriptor);
          else Reflect.deleteProperty(scheduler, 'yield');
        }
      },
    } });
  }, options);
}
