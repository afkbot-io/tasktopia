import { api, ApiError } from "./api";
import type { MapAttentionPage, MapAttentionTask } from "../shared/map-attention";
/** Publish only a complete revision. One restart absorbs a concurrent edit;
 * continuous edits remain a recoverable error rather than an endless loop. */
export async function loadMapAttention(countryId: string, cityId: string, signal: AbortSignal,
  read: (path: string, signal: AbortSignal) => Promise<MapAttentionPage> = (path, signal) => api(path, { signal }),
): Promise<MapAttentionTask[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const all: MapAttentionTask[] = [];
      const seen = new Set<string>();
      let after: string | null = null, snapshot: number | undefined;
      do {
        signal.throwIfAborted();
        const query = new URLSearchParams({ countryId, cityId });
        if (after) query.set("after", after);
        if (snapshot !== undefined) query.set("revision", String(snapshot));
        const page = await read(`/api/map-attention?${query}`, signal);
        signal.throwIfAborted();
        if (snapshot !== undefined && snapshot !== page.revision) throw new ApiError(409, "Changed snapshot");
        snapshot = page.revision;
        for (const task of page.tasks) {
          if (seen.has(task.id)) throw new Error("Repeated metadata task");
          seen.add(task.id); all.push(task);
        }
        if (page.next && (page.next === after || page.next !== page.tasks.at(-1)?.id)) throw new Error("Invalid metadata cursor");
        after = page.next;
      } while (after);
      return all;
    } catch (error) {
      if (signal.aborted || !(error instanceof ApiError) || error.status !== 409 || attempt === 1) throw error;
    }
  }
  throw new Error("Unreachable metadata load");
}
