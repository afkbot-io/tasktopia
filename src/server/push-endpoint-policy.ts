/** Reviewed browser-provider policy, not a DNS preflight. User-controlled
 * origins never reach the transport. New providers require a reviewed change;
 * see ADR 0005 for the primary provider documentation. */
export function approvedPushEndpoint(input: unknown): string {
  if (typeof input !== "string" || input.length > 2_048) throw new Error("Некорректный push endpoint");
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("Некорректный push endpoint"); }
  const host = url.hostname;
  const approved = host === "fcm.googleapis.com" || host === "android.googleapis.com"
    || host === "updates.push.services.mozilla.com"
    || host.endsWith(".push.apple.com") || host.endsWith(".notify.windows.com");
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash || !approved) {
    throw new Error("Push endpoint не принадлежит поддерживаемому провайдеру");
  }
  return url.toString();
}
