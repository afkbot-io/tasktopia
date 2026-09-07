import { PLANET_ATLAS_SCHEMA_VERSION, type PlanetAtlasDto } from "../shared/planet-atlas-contract";
import { api } from "./api";
import { RevisionCache } from "./map-scene-cache";

export function planetAtlasCacheKey(userId: string): string {
  return `tasktopia:planet-atlas:v${PLANET_ATLAS_SCHEMA_VERSION}:user:${userId}`;
}

// Session memory only: do not keep private country/task summaries in browser
// storage after logout, or serve persisted membership data before authorization.
const cache = new RevisionCache<PlanetAtlasDto>(2);
export const PLANET_REVALIDATE_MS = 30_000;
const checkedAt = new Map<string, number>();
const lastFrames = new Map<string, PlanetAtlasDto>();
let sessionEpoch = 0;
const fetchPlanet = () => api<PlanetAtlasDto>("/api/planet-atlas", { cache: "no-cache" });
const keyFor = (userId: string, revision: number) => `${planetAtlasCacheKey(userId)}:${revision}`;
export function clearPlanetAtlasCache(): void { sessionEpoch += 1; cache.clear(); checkedAt.clear(); lastFrames.clear(); }
export function peekPlanetAtlas(userId: string, revision: number): PlanetAtlasDto | undefined {
  return cache.peek(keyFor(userId, revision)) ?? lastFrames.get(keyFor(userId, revision));
}
export function loadPlanetAtlas(userId: string, revision: number, load = fetchPlanet): Promise<PlanetAtlasDto> {
  const key = keyFor(userId, revision);
  const epoch = sessionEpoch;
  if (Date.now() - (checkedAt.get(key) ?? -Infinity) >= PLANET_REVALIDATE_MS && !cache.hasPending(key)) cache.delete(key);
  return cache.read(key, async () => {
    const next = await load();
    if (epoch !== sessionEpoch) throw new DOMException("Planet session changed", "AbortError");
    if (next.schemaVersion !== PLANET_ATLAS_SCHEMA_VERSION) throw new Error("Версия планеты устарела. Обновите страницу");
    checkedAt.delete(key); checkedAt.set(key, Date.now());
    lastFrames.delete(key); lastFrames.set(key, next);
    while (checkedAt.size > 2) checkedAt.delete(checkedAt.keys().next().value!);
    while (lastFrames.size > 2) lastFrames.delete(lastFrames.keys().next().value!);
    return next;
  });
}

/** Only the visible PLANET owns this timer. Other countries have no active
 * socket subscription, so their authorized atlas needs bounded revalidation. */
export function watchPlanetAtlas(userId: string, revision: number, onAtlas: (atlas: PlanetAtlasDto) => void,
  onError: (error: unknown) => void, load = fetchPlanet): () => void {
  let disposed = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = async () => {
    if (disposed || document.hidden || running) return;
    running = true;
    let failed = false;
    try {
      const next = await loadPlanetAtlas(userId, revision, load);
      if (!disposed && !document.hidden) onAtlas(next);
    } catch (error) {
      failed = true;
      if (!disposed && !document.hidden) onError(error);
    } finally {
      running = false;
      if (!disposed && !document.hidden) {
        const remaining = PLANET_REVALIDATE_MS - (Date.now() - (checkedAt.get(keyFor(userId, revision)) ?? 0));
        timer = setTimeout(() => { void refresh(); }, failed ? PLANET_REVALIDATE_MS : Math.max(1, remaining));
      }
    }
  };
  const visibility = () => { clearTimeout(timer); if (!document.hidden) void refresh(); };
  document.addEventListener("visibilitychange", visibility);
  void refresh();
  return () => { disposed = true; clearTimeout(timer); document.removeEventListener("visibilitychange", visibility); };
}
