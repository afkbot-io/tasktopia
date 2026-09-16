export type WorldPreferences = { lighting: "REAL_TIME" | "DAY"; quality: "AUTO" | "NORMAL" | "ECONOMY" };
const defaults: WorldPreferences = { lighting: "REAL_TIME", quality: "AUTO" };
const storageKey = "tasktopia:world-preferences:v1";
let snapshot = defaults;
let initialized = false;
const listeners = new Set<() => void>();
export function parseWorldPreferences(raw: string | null): WorldPreferences {
  try {
    const value = JSON.parse(raw ?? "null");
    return { lighting: value?.lighting === "DAY" ? "DAY" : "REAL_TIME",
      quality: value?.quality === "NORMAL" || value?.quality === "ECONOMY" ? value.quality : "AUTO" };
  } catch { return defaults; }
}
function publish(next: WorldPreferences) {
  if (next.lighting === snapshot.lighting && next.quality === snapshot.quality) return;
  snapshot = next;
  listeners.forEach(listener => listener());
}
export function readWorldPreferences(): WorldPreferences {
  if (!initialized && typeof window !== "undefined") {
    initialized = true;
    try { snapshot = parseWorldPreferences(window.localStorage.getItem(storageKey)); } catch { /* In-memory preferences remain available. */ }
    window.addEventListener("storage", event => {
      if (event.key === storageKey || event.key === null) publish(parseWorldPreferences(event.newValue));
    });
  }
  return snapshot;
}
export function setWorldPreferences(patch: Partial<WorldPreferences>) {
  const next = { ...readWorldPreferences(), ...patch };
  try { window.localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Storage can be disabled. */ }
  publish(next);
}
export function subscribeWorldPreferences(listener: () => void) {
  readWorldPreferences();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const serverWorldPreferences = () => defaults;
