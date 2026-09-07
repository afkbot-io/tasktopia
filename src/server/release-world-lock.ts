import postgres from "postgres";

/** A dedicated pinned transaction, not a session lock borrowed from a pool.
 * Country writes retain their own transactions; this connection owns only the
 * release-wide mutex. Both failure and success release it on the same backend.
 */
export async function withReleaseWorldLock<T>(
  databaseUrl: string,
  operation: () => Promise<T>,
  lockName = "tasktopia:release-world-regeneration",
): Promise<T> {
  const lock = postgres(databaseUrl, {
    max: 1, idle_timeout: 0, max_lifetime: 0, connect_timeout: 10,
    onnotice: () => undefined,
  });
  try {
    return await lock.begin(async sql => {
      const [row] = await sql<{ acquired: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${lockName})) AS acquired`;
      if (!row?.acquired) throw new Error("Another release-wide world regeneration is already running");
      return await operation();
    }) as T;
  } finally { await lock.end({ timeout: 5 }); }
}
