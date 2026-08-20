import postgres from "postgres";
import type { RealtimeEvent } from "../shared/contracts";
import type { Db } from "./db";

const CHANNEL = "tasktopia_world_event_v1";

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
