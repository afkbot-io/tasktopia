import type { RealtimeEvent } from "../shared/contracts";
import { presentRealtimeNotice } from "../shared/realtime-notifications";
import type { Db } from "./db";
import type { PushGateway } from "./push-gateway";
import type { BrowserPushSubscription } from "./push-subscriptions";

type EventRow = Record<string, unknown>;
type DeliveryRow = Record<string, unknown>;

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

export function pushPayloadForEvent(event: RealtimeEvent): Record<string, string> | null {
  const notice = presentRealtimeNotice(event);
  if (!notice) return null;
  const taskNumber = notice.target?.taskNumber;
  return {
    title: notice.title.slice(0, 160),
    body: notice.location.slice(0, 240),
    url: taskNumber ? `/task/${taskNumber}` : "/",
    tag: `event-${event.id}`,
  };
}

async function enqueueNewEvents(db: Db, batchSize: number): Promise<number> {
  return db.transaction(async () => {
    const cursor = await db.prepare("SELECT event_id FROM push_delivery_cursor_v1 WHERE singleton=true FOR UPDATE")
      .get<{ event_id: number }>();
    const rows = await db.prepare(`SELECT id, country_id, type, world_version, payload_json, created_at
      FROM events WHERE id > ? ORDER BY id LIMIT ?`).all(Number(cursor?.event_id ?? 0), batchSize) as EventRow[];
    for (const row of rows) {
      const event = eventFromRow(row);
      const payload = pushPayloadForEvent(event);
      if (payload) {
        await db.prepare(`INSERT INTO push_deliveries_v1(event_id, subscription_id, payload_json)
          SELECT ?, subscription.id, ?::jsonb
          FROM push_subscriptions_v1 subscription
          JOIN country_members member ON member.user_id=subscription.user_id
          WHERE member.country_id=?
          ON CONFLICT (event_id, subscription_id) DO NOTHING`)
          .run(event.id, JSON.stringify(payload), event.countryId);
      }
    }
    const latest = rows.at(-1);
    if (latest) await db.prepare("UPDATE push_delivery_cursor_v1 SET event_id=? WHERE singleton=true").run(Number(latest.id));
    return rows.length;
  });
}

function failureStatus(error: unknown): number | undefined {
  const status = Number((error as { statusCode?: unknown } | null)?.statusCode);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : undefined;
}

async function deliverOne(db: Db, gateway: PushGateway, deliveryId: number): Promise<void> {
  await db.transaction(async () => {
    const row = await db.prepare(`SELECT delivery.id, delivery.attempts, delivery.payload_json,
      subscription.id AS subscription_id, subscription.endpoint, subscription.p256dh, subscription.auth,
      subscription.expiration_time,
      EXISTS (SELECT 1 FROM events event JOIN country_members member ON member.country_id=event.country_id
        WHERE event.id=delivery.event_id AND member.user_id=subscription.user_id) AS authorized
      FROM push_deliveries_v1 delivery
      LEFT JOIN push_subscriptions_v1 subscription ON subscription.id=delivery.subscription_id
      WHERE delivery.id=? AND delivery.status IN ('PENDING','RETRY') AND delivery.next_attempt_at <= now()
      FOR UPDATE OF delivery`).get<DeliveryRow>(deliveryId);
    if (!row) return;
    if (!row.subscription_id || !row.authorized) {
      await db.prepare("UPDATE push_deliveries_v1 SET status='FAILED', last_error_code='NOT_AUTHORIZED', updated_at=now() WHERE id=?")
        .run(deliveryId);
      return;
    }
    const subscription: BrowserPushSubscription = {
      endpoint: String(row.endpoint),
      expirationTime: row.expiration_time === null ? null : Number(row.expiration_time),
      keys: { p256dh: String(row.p256dh), auth: String(row.auth) },
    };
    const payload = typeof row.payload_json === "string" ? row.payload_json : JSON.stringify(row.payload_json);
    const attempt = Number(row.attempts) + 1;
    try {
      await gateway.send(subscription, payload);
      await db.prepare(`UPDATE push_deliveries_v1 SET status='SENT', attempts=?, delivered_at=now(),
        last_error_code=NULL, updated_at=now() WHERE id=?`).run(attempt, deliveryId);
    } catch (error) {
      const status = failureStatus(error);
      if (status === 404 || status === 410) {
        await db.prepare("DELETE FROM push_subscriptions_v1 WHERE id=?").run(String(row.subscription_id));
        await db.prepare(`UPDATE push_deliveries_v1 SET status='FAILED', attempts=?, last_error_code='GONE', updated_at=now() WHERE id=?`)
          .run(attempt, deliveryId);
        return;
      }
      const retryable = status === undefined || status === 408 || status === 429 || status >= 500;
      if (retryable && attempt < 3) {
        await db.prepare(`UPDATE push_deliveries_v1 SET status='RETRY', attempts=?, last_error_code=?,
          next_attempt_at=now() + (? * interval '1 second'), updated_at=now() WHERE id=?`)
          .run(attempt, status ? `HTTP_${status}` : "NETWORK", 2 ** attempt, deliveryId);
      } else {
        await db.prepare(`UPDATE push_deliveries_v1 SET status='FAILED', attempts=?, last_error_code=?, updated_at=now() WHERE id=?`)
          .run(attempt, status ? `HTTP_${status}` : "RETRIES_EXHAUSTED", deliveryId);
      }
    }
  });
}

export async function runPushDeliveryCycle(db: Db, gateway: PushGateway, batchSize = 50): Promise<void> {
  await enqueueNewEvents(db, batchSize);
  const deliveries = await db.prepare(`SELECT id FROM push_deliveries_v1
    WHERE status IN ('PENDING','RETRY') AND next_attempt_at <= now() ORDER BY id LIMIT ?`).all<{ id: number }>(batchSize);
  for (const delivery of deliveries) await deliverOne(db, gateway, Number(delivery.id));
}

export function startPushDeliveryWorker(
  db: Db,
  gateway: PushGateway | undefined,
  onError: (error: unknown) => void,
  pollIntervalMs = 5_000,
): { close(): Promise<void> } | undefined {
  if (!gateway) return undefined;
  let closed = false;
  let pumping: Promise<void> = Promise.resolve();
  const pump = () => {
    if (closed) return;
    pumping = pumping.catch(() => undefined).then(() => runPushDeliveryCycle(db, gateway)).catch(onError);
  };
  pump();
  const timer = setInterval(pump, pollIntervalMs);
  timer.unref();
  return {
    async close() {
      closed = true;
      clearInterval(timer);
      await pumping.catch(() => undefined);
    },
  };
}
