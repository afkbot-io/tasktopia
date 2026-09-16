/** Immutable geographic source for a newly created world. Absence means the
 * original river/lake generator; never infer a sea from a viewport boundary. */
export type WorldTerrainProfile = { version: 1; kind: "EAST_COAST"; coastX: number };

export function parseWorldTerrainProfile(value: unknown): WorldTerrainProfile | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid world terrain profile");
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || record.kind !== "EAST_COAST" || typeof record.coastX !== "number"
    || !Number.isSafeInteger(record.coastX) || Math.abs(record.coastX) > 1_000_000) {
    throw new Error("Invalid world terrain profile");
  }
  return { version: 1, kind: "EAST_COAST", coastX: record.coastX };
}

/** Nine cells of bounded shoreline variation. The eastern half-plane beyond
 * coastX+16 is provably deep open water at every latitude, not a closed lake. */
export function coastlineX(seed: number, y: number, profile: WorldTerrainProfile): number {
  const phase = (seed >>> 0) % 6283 / 1000;
  return profile.coastX + Math.round(6 * Math.sin(y / 48 + phase) + 3 * Math.sin(y / 17 + phase));
}
