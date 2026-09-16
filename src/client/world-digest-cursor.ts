const memory = new Map<string, number>();
export const worldDigestCursorKey = (userId: string, countryId: string) => `tasktopia:digest:v1:${userId}:${countryId}`;
export function readDigestCursor(key: string): number | null {
  let stored: number | undefined;
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null && /^\d+$/.test(raw)) {
      const value = Number(raw);
      if (Number.isSafeInteger(value)) stored = value;
    }
  } catch { /* Keep the session cursor when storage is disabled. */ }
  const cached = memory.get(key);
  return cached === undefined ? stored ?? null : Math.max(cached, stored ?? 0);
}
/** Cross-tab read/modify/write is serialized when Web Locks is available.
 * The memory fallback remains usable in restricted/private browser contexts. */
async function updateCursor(key: string, write: () => void): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    try { await navigator.locks.request(key, write); return; } catch { /* Restricted lock manager. */ }
  }
  write();
}
export async function rememberDigestCursor(key: string, cursor: number): Promise<void> {
  if (!Number.isSafeInteger(cursor) || cursor < 0) return;
  await updateCursor(key, () => {
    const next = Math.max(readDigestCursor(key) ?? 0, cursor);
    memory.set(key, next);
    try { localStorage.setItem(key, String(next)); } catch { /* Session cursor. */ }
  });
}

export async function establishDigestBaseline(key: string, cursor: number, expected: number | null = null): Promise<void> {
  if (!Number.isSafeInteger(cursor) || cursor < 0) return;
  await updateCursor(key, () => {
    const current = readDigestCursor(key);
    // Only reset a future cursor if this is the value validated by the server.
    // A late first-visit response cannot overwrite another tab's newer result.
    const next = current === expected ? cursor : Math.max(current ?? 0, cursor);
    memory.set(key, next);
    try { localStorage.setItem(key, String(next)); } catch { /* Session baseline. */ }
  });
}
