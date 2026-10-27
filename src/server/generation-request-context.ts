import { AsyncLocalStorage } from "node:async_hooks";

const requestSignal = new AsyncLocalStorage<AbortSignal>();

export function runWithGenerationRequestSignal<T>(signal: AbortSignal, callback: () => T): T {
  return requestSignal.run(signal, callback);
}

export function currentGenerationRequestSignal(): AbortSignal | undefined {
  return requestSignal.getStore();
}
