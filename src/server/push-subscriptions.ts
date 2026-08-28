import { createHash, randomUUID } from "node:crypto";
import type { Db } from "./db";

export type BrowserPushSubscription = {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
};

function base64UrlBytes(value: unknown, expectedBytes: number, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`Некорректный ключ ${label}`);
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== expectedBytes || decoded.toString("base64url") !== value.replace(/=+$/, "")) {
    throw new Error(`Некорректный ключ ${label}`);
  }
  return value;
}

export function normalizePushSubscription(input: unknown): BrowserPushSubscription {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Некорректная push-подписка");
  const candidate = input as Record<string, unknown>;
  if (typeof candidate.endpoint !== "string" || candidate.endpoint.length > 2_048) throw new Error("Некорректный push endpoint");
  let endpoint: URL;
  try { endpoint = new URL(candidate.endpoint); } catch { throw new Error("Некорректный push endpoint"); }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.hash) throw new Error("Некорректный push endpoint");
  if (candidate.expirationTime !== null && candidate.expirationTime !== undefined
    && (!Number.isSafeInteger(candidate.expirationTime) || Number(candidate.expirationTime) <= 0)) {
    throw new Error("Некорректный срок push-подписки");
  }
  if (!candidate.keys || typeof candidate.keys !== "object" || Array.isArray(candidate.keys)) throw new Error("Отсутствуют ключи push-подписки");
  const keys = candidate.keys as Record<string, unknown>;
  const p256dh = base64UrlBytes(keys.p256dh, 65, "p256dh");
  if (Buffer.from(p256dh, "base64url")[0] !== 4) throw new Error("Некорректный ключ p256dh");
  return {
    endpoint: endpoint.toString(),
    expirationTime: candidate.expirationTime === undefined ? null : candidate.expirationTime as number | null,
    keys: { p256dh, auth: base64UrlBytes(keys.auth, 16, "auth") },
  };
}

export function pushEndpointHash(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex");
}

export async function hasPushSubscription(db: Db, userId: string): Promise<boolean> {
  return Boolean(await db.prepare("SELECT 1 FROM push_subscriptions_v1 WHERE user_id = ? LIMIT 1").get(userId));
}

export async function savePushSubscription(db: Db, userId: string, input: unknown): Promise<BrowserPushSubscription> {
  const subscription = normalizePushSubscription(input);
  const endpointHash = pushEndpointHash(subscription.endpoint);
  const existing = await db.prepare("SELECT user_id FROM push_subscriptions_v1 WHERE endpoint_hash = ?")
    .get<{ user_id: string }>(endpointHash);
  if (existing && existing.user_id !== userId) throw new Error("PUSH_ENDPOINT_OWNED");
  const timestamp = new Date().toISOString();
  await db.prepare(`INSERT INTO push_subscriptions_v1
    (id, user_id, endpoint, endpoint_hash, p256dh, auth, expiration_time, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (endpoint_hash) DO UPDATE SET p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth,
      expiration_time=EXCLUDED.expiration_time, updated_at=EXCLUDED.updated_at`)
    .run(randomUUID(), userId, subscription.endpoint, endpointHash, subscription.keys.p256dh,
      subscription.keys.auth, subscription.expirationTime, timestamp, timestamp);
  return subscription;
}

export async function removePushSubscription(db: Db, userId: string, endpointInput: unknown): Promise<void> {
  const normalized = normalizeEndpoint(endpointInput);
  await db.prepare("DELETE FROM push_subscriptions_v1 WHERE user_id = ? AND endpoint_hash = ?")
    .run(userId, pushEndpointHash(normalized));
}

function normalizeEndpoint(input: unknown): string {
  if (typeof input !== "string" || input.length > 2_048) throw new Error("Некорректный push endpoint");
  let endpoint: URL;
  try { endpoint = new URL(input); } catch { throw new Error("Некорректный push endpoint"); }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.hash) {
    throw new Error("Некорректный push endpoint");
  }
  return endpoint.toString();
}
