/** Bound shared map reads independently of any one mounted subscriber. */
export function loadMapWithTimeout<T>(load: (signal: AbortSignal) => Promise<T>, timeoutMs = 20_000): Promise<T> {
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Карта загружается слишком долго. Проверьте соединение и повторите попытку."));
      controller.abort();
    }, timeoutMs);
    Promise.resolve().then(() => load(controller.signal)).then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
