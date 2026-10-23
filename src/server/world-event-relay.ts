import type { WorldEventRelayStats } from "./runtime-stat-contracts";
import postgres from "postgres";
import type { RealtimeEvent } from "../shared/contracts";
import type { Db } from "./db";
import { startBackgroundPoll } from "./background-poll";

const CHANNEL = "tasktopia_world_event_v1";

type EventRow = Record<string, unknown>;

function eventFromRow(row: EventRow): RealtimeEvent {
  return {
    id: Number(row.id),
    countryId: String(row.country_id),
    type: String(row.type),
    worldVersion: Number(row.world_version),
    payload: (typeof row.payload_json === "string" ? JSON.parse(row.payload_json) : row.payload_json) as Record<string, unknown>,
    createdAt: String(row.created_at),
  };
}

export async function publishWorldEvent(db: Db, event: RealtimeEvent): Promise<void> {
  // Publish only the durable event id. PostgreSQL NOTIFY payloads are bounded;
  // the web runtime reads the canonical row after receiving the signal.
  await db.prepare(`SELECT pg_notify('${CHANNEL}', ?)`).get(String(event.id));
}

export async function subscribeToWorldEvents(
  databaseUrl: string,
  onEventId: (eventId: number) => void | Promise<void>,
  onError: (error: unknown) => void = () => undefined,
): Promise<{ close(): Promise<void> }> {
  const listener = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  let subscription: Awaited<ReturnType<typeof listener.listen>>;
  try {
    subscription = await listener.listen(CHANNEL, (payload) => {
      const eventId = Number(payload);
      if (Number.isSafeInteger(eventId) && eventId > 0) {
        void Promise.resolve().then(() => onEventId(eventId)).catch(onError).catch(() => undefined);
      }
    });
  } catch (error) {
    await listener.end({ timeout: 5 }).catch(() => undefined);
    throw error;
  }
  return {
    async close() {
      try { await subscription.unlisten(); }
      finally { await listener.end({ timeout: 5 }); }
    },
  };
}

/**
 * Notifications wake a durable feed ordered within each country. Sequence ids
 * from different country transactions can commit out of order, so a global
 * high-water mark would permanently skip a slower country's earlier id.
 * Existing history is the startup baseline; reconnects replay from /api/events.
 */
export async function consumeDurableWorldEvents(
  db: Db,
  databaseUrl: string,
  onEvent: (event: RealtimeEvent) => void | Promise<void>,
  pollIntervalMs = 5_000,
  onError: (error: unknown) => void = () => undefined,
): Promise<{ close(): Promise<void>; runtimeStats(): WorldEventRelayStats }> {
  const cursors = new Map<string, number>();
  let initialized = false; let notifications = 0; let delivered = 0;
  let closed = false;
  let notifiedDuringStartup = false;
  let nextCountry = 0;
  const readHeads = () => db.prepare(`SELECT country.id AS country_id, COALESCE(latest.id, 0) AS id
    FROM countries country LEFT JOIN LATERAL (
      SELECT id FROM events WHERE country_id=country.id ORDER BY id DESC LIMIT 1
    ) latest ON true ORDER BY country.id`).all<EventRow>();

  const schedule = (eventId: number) => {
    if (!Number.isSafeInteger(eventId) || eventId <= 0 || closed) return;
    notifications++;
    if (!initialized) { notifiedDuringStartup = true; return; }
    poll.trigger();
  };

  const subscription = await subscribeToWorldEvents(databaseUrl, schedule, onError);
  try {
    for (const row of await readHeads()) cursors.set(String(row.country_id), Number(row.id));
  } catch (error) {
    await subscription.close().catch(() => undefined);
    throw error;
  }
  const poll = startBackgroundPoll(async () => {
    const heads = await readHeads();
    const countries = new Set(heads.map(row => String(row.country_id)));
    for (const countryId of cursors.keys()) if (!countries.has(countryId)) cursors.delete(countryId);
    let batches = 0;
    const start = heads.length ? nextCountry % heads.length : 0;
    // Round-robin countries and bounded batches prevent one backlog from
    // monopolizing the relay; a queued wake continues the next batch immediately.
    for (let offset = 0; !closed && offset < heads.length && batches < 8; offset += 1) {
      const index = (start + offset) % heads.length;
      nextCountry = (index + 1) % heads.length;
      const head = heads[index]!;
      const countryId = String(head.country_id);
      const cursor = cursors.get(countryId) ?? 0;
      const target = Number(head.id);
      if (cursor >= target) continue;
      const rows = await db.prepare(`SELECT id, country_id, type, world_version, payload_json, created_at
        FROM events WHERE country_id = ? AND id > ? AND id <= ? ORDER BY id LIMIT 500`).all<EventRow>(countryId, cursor, target);
      batches += 1;
      if (rows.length === 0) { cursors.set(countryId, target); continue; }
      for (const row of rows) {
        if (closed) break;
        const event = eventFromRow(row);
        await onEvent(event); delivered++;
        cursors.set(countryId, event.id);
      }
    }
    if (!closed && heads.some(row => Number(row.id) > (cursors.get(String(row.country_id)) ?? 0))) poll.trigger();
  }, pollIntervalMs, onError);
  initialized = true;
  if (notifiedDuringStartup) poll.trigger();

  return {
    runtimeStats() { return { initialized, closed, countryCursors: cursors.size, notifications, delivered, poll: poll.runtimeStats() }; },
    async close() {
      closed = true;
      await poll.close();
      await subscription.close(); cursors.clear();
    },
  };
}
