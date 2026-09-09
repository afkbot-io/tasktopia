/** A stalled map image must release its network slot before a retry. */
export async function loadMapImage(url: string, signal?: AbortSignal, timeoutMs = 20_000): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = "async";
  image.crossOrigin = "anonymous";
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) { image.removeAttribute("src"); reject(error); }
      else resolve(image);
    };
    const abort = () => finish(new DOMException("Map image cancelled", "AbortError"));
    const timer = setTimeout(() => finish(new Error("Не удалось вовремя загрузить графику карты. Повторите попытку.")), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    image.src = url;
    void image.decode().then(() => finish(), () => finish(new Error("Не удалось загрузить графику карты. Повторите попытку.")));
  });
}
