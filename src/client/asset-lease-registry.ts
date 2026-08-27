import { Assets } from "pixi.js";

type AssetRecord = { refs: number; loaded: boolean; timer?: ReturnType<typeof setTimeout> };

const records = new Map<string, AssetRecord>();
const pendingLoads = new Map<string, Promise<void>>();
const pendingUnloads = new Map<string, Promise<void>>();
const UNLOAD_GRACE_MS = 2_000;

function unloadWhenIdle(url: string): void {
  const latest = records.get(url);
  if (!latest || latest.refs > 0) return;
  if (pendingLoads.has(url)) {
    latest.timer = setTimeout(() => unloadWhenIdle(url), 250);
    return;
  }
  records.delete(url);
  const unloading = Assets.unload(url).then(() => undefined, () => undefined);
  pendingUnloads.set(url, unloading);
  void unloading.finally(() => {
    if (pendingUnloads.get(url) === unloading) pendingUnloads.delete(url);
  });
}

function retain(url: string): void {
  const record = records.get(url) ?? { refs: 0, loaded: false };
  if (record.timer) clearTimeout(record.timer);
  record.timer = undefined;
  record.refs += 1;
  records.set(url, record);
}

function release(url: string): void {
  const record = records.get(url);
  if (!record) return;
  record.refs = Math.max(0, record.refs - 1);
  if (record.refs > 0) return;
  record.timer = setTimeout(() => unloadWhenIdle(url), UNLOAD_GRACE_MS);
}

/** Owns every texture first requested by one mounted map scene. */
export class AssetLease {
  private readonly owned = new Set<string>();
  private disposed = false;

  async load(urls: string[], loader: (urls: string[]) => Promise<void>): Promise<void> {
    if (this.disposed) throw new DOMException("Asset lease disposed", "AbortError");
    const next = [...new Set(urls)].filter((url) => !this.owned.has(url));
    if (next.length === 0) return;
    for (const url of next) { this.owned.add(url); retain(url); }
    const existing = next.flatMap((url) => {
      const pending = pendingLoads.get(url);
      return pending ? [pending] : [];
    });
    const fresh = next.filter((url) => !pendingLoads.has(url) && !records.get(url)?.loaded);
    let batch: Promise<void> | undefined;
    if (fresh.length > 0) {
      const unloads = [...new Set(fresh.flatMap((url) => {
        const pending = pendingUnloads.get(url);
        return pending ? [pending] : [];
      }))];
      // Pixi may leave Assets.load unresolved when it races Assets.unload for
      // the same alias. A new scene waits for the old GPU/cache release, then
      // performs one fresh batch load.
      batch = unloads.length > 0 ? Promise.all(unloads).then(() => loader(fresh)) : loader(fresh);
      for (const url of fresh) pendingLoads.set(url, batch);
      void batch.finally(() => {
        for (const url of fresh) if (pendingLoads.get(url) === batch) pendingLoads.delete(url);
      }).catch(() => undefined);
    }
    try {
      await Promise.all(batch ? [...existing, batch] : existing);
      for (const url of fresh) {
        const record = records.get(url);
        if (record) record.loaded = true;
      }
    }
    catch (error) {
      for (const url of next) { this.owned.delete(url); release(url); }
      throw error;
    }
  }

  get size(): number { return this.owned.size; }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const url of this.owned) release(url);
    this.owned.clear();
  }
}

export function leasedAssetCount(): number {
  return [...records.values()].filter((record) => record.refs > 0).length;
}
