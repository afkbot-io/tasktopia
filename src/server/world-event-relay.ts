import postgres from "postgres";
import type { RealtimeEvent } from "../shared/contracts";
import type { Db } from "./db";

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
): Promise<{ close(): Promise<void> }> {
  const listener = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  const subscription = await listener.listen(CHANNEL, (payload) => {
    const eventId = Number(payload);
    if (Number.isSafeInteger(eventId) && eventId > 0) void onEventId(eventId);
  });
  return {
    async close() {
      await subscription.unlisten();
      await listener.end({ timeout: 5 });
    },
  };
}

/**
 * Converts lossy PostgreSQL notifications into an ordered durable event feed.
 * A notification is only a high-water mark: every missing row up to that id is
 * replayed from `events`, and a bounded poll closes a gap if no later NOTIFY
 * arrives. Existing history is the startup baseline because a fresh web
 * runtime has no warm projections; browser reconnects replay from /api/events.
 */
export async function consumeDurableWorldEvents(
  db: Db,
  databaseUrl: string,
  onEvent: (event: RealtimeEvent) => void | Promise<void>,
  pollIntervalMs = 5_000,
): Promise<{ close(): Promise<void> }> {
  let cursor = 0;
  let highWaterMark = 0;
  let initialized = false;
  let closed = false;
  let drain: Promise<void> = Promise.resolve();

  const schedule = (eventId: number) => {
    if (!Number.isSafeInteger(eventId) || eventId <= 0 || closed) return;
    highWaterMark = Math.max(highWaterMark, eventId);
    if (!initialized) return;
    drain = drain.catch(() => undefined).then(async () => {
      while (!closed && cursor < highWaterMark) {
        const target = highWaterMark;
        const rows = await db.prepare(`SELECT id, country_id, type, world_version, payload_json, created_at
          FROM events WHERE id > ? AND id <= ? ORDER BY id LIMIT 500`).all(cursor, target) as EventRow[];
        if (rows.length === 0) {
          cursor = target;
          continue;
        }
        for (const row of rows) {
          const event = eventFromRow(row);
          await onEvent(event);
          cursor = event.id;
        }
      }
    });
  };

  const subscription = await subscribeToWorldEvents(databaseUrl, schedule);
  const baseline = await db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM events").get() as EventRow | undefined;
  cursor = Number(baseline?.id ?? 0);
  initialized = true;
  if (highWaterMark > cursor) schedule(highWaterMark);
  const poll = setInterval(() => void db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM events").get()
    .then((row) => schedule(Number((row as EventRow | undefined)?.id ?? 0))), pollIntervalMs);
  poll.unref();

  return {
    async close() {
      closed = true;
      clearInterval(poll);
      await drain.catch(() => undefined);
      await subscription.close();
    },
  };
}
