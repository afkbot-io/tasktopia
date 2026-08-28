import { api } from "./api";

type PushStatus = { configured: boolean; publicKey: string | null; subscribed: boolean };
export type PushUiState = {
  kind: "unsupported" | "not-installed" | "unavailable" | "denied" | "disabled" | "enabled";
  message: string;
};

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

function browserSupportsPush(): boolean {
  return window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function activeRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  return await navigator.serviceWorker.getRegistration("/");
}

function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const binary = atob((value + padding).replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function readPushUiState(): Promise<PushUiState> {
  if (isIos() && !isStandalone()) {
    return { kind: "not-installed", message: "На iPhone и iPad добавьте Tasktopia на экран «Домой», затем включите уведомления здесь." };
  }
  if (!browserSupportsPush()) return { kind: "unsupported", message: "Этот браузер не поддерживает Web Push." };
  const status = await api<PushStatus>("/api/push/status");
  if (!status.configured || !status.publicKey) return { kind: "unavailable", message: "Push-уведомления временно не настроены на сервере." };
  if (Notification.permission === "denied") return { kind: "denied", message: "Уведомления запрещены в настройках браузера." };
  const local = await (await activeRegistration())?.pushManager.getSubscription();
  if (local && Notification.permission === "granted") {
    // Browser subscription rotation can happen while the app is closed and the
    // service worker POST can lose its session. Foreground reconciliation is
    // safe here: permission already exists and no system prompt is involved.
    await api("/api/push/subscriptions", { method: "POST", json: local.toJSON() });
    return { kind: "enabled", message: "Уведомления о событиях ваших стран включены на этом устройстве." };
  }
  return { kind: "disabled", message: "Получайте уведомления о статусах, дефектах и изменениях задач." };
}

export async function enablePushNotifications(): Promise<PushUiState> {
  if (!browserSupportsPush()) return readPushUiState();
  const status = await api<PushStatus>("/api/push/status");
  if (!status.configured || !status.publicKey) return { kind: "unavailable", message: "Push-уведомления временно не настроены на сервере." };
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") return readPushUiState();
  const registration = await activeRegistration()
    ?? await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey(status.publicKey),
  });
  try {
    await api("/api/push/subscriptions", { method: "POST", json: subscription.toJSON() });
  } catch (error) {
    if (!existing) await subscription.unsubscribe().catch(() => false);
    throw error;
  }
  return { kind: "enabled", message: "Уведомления о событиях ваших стран включены на этом устройстве." };
}

export async function disablePushNotifications(): Promise<PushUiState> {
  if (!browserSupportsPush()) return readPushUiState();
  const subscription = await (await activeRegistration())?.pushManager.getSubscription();
  if (subscription) {
    await api("/api/push/subscriptions", { method: "DELETE", json: { endpoint: subscription.endpoint } });
    await subscription.unsubscribe();
  }
  return { kind: "disabled", message: "Push-уведомления отключены на этом устройстве." };
}

export async function clearPushSubscriptionForLogout(): Promise<void> {
  if (!browserSupportsPush()) return;
  const registration = await activeRegistration().catch(() => undefined);
  const subscription = await registration?.pushManager.getSubscription().catch(() => null);
  if (!subscription) return;
  await api("/api/push/subscriptions", { method: "DELETE", json: { endpoint: subscription.endpoint } }).catch(() => undefined);
  await subscription.unsubscribe().catch(() => false);
}
