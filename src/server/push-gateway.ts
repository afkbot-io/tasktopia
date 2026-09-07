import webPush from "web-push";
import type { BrowserPushSubscription } from "./push-subscriptions";
import { approvedPushEndpoint } from "./push-endpoint-policy";

export type PushSendResult = { statusCode: number };
export type PushGateway = {
  send(subscription: BrowserPushSubscription, payload: string): Promise<PushSendResult>;
};

export type VapidConfig = { subject: string; publicKey: string; privateKey: string };
const PUSH_DELIVERY_DEADLINE_MS = 5_000;

export function createWebPushGateway(vapid: VapidConfig | undefined): PushGateway | undefined {
  if (!vapid) return undefined;
  return {
    async send(subscription, payload) {
      let request: webPush.RequestDetails;
      try {
        const endpoint = approvedPushEndpoint(subscription.endpoint);
        request = webPush.generateRequestDetails({ ...subscription, endpoint }, payload, {
          TTL: 300, urgency: "normal", vapidDetails: vapid,
        });
      } catch {
        throw Object.assign(new Error("PUSH_SUBSCRIPTION_REJECTED"), { statusCode: 400 });
      }
      // The library's timeout is socket-idle only, not an overall deadline.
      // Keep its VAPID/encryption implementation, but own the abortable HTTPS
      // transport. Never follow redirects or buffer provider response bodies.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PUSH_DELIVERY_DEADLINE_MS);
      try {
        const response = await fetch(request.endpoint, {
          method: request.method, headers: request.headers,
          body: request.body ? new Uint8Array(request.body) : undefined,
          redirect: "manual", signal: controller.signal,
        });
        void response.body?.cancel().catch(() => undefined);
        if (response.status < 200 || response.status >= 300) {
          throw Object.assign(new Error("PUSH_PROVIDER_REJECTED"), { statusCode: response.status });
        }
        return { statusCode: response.status };
      } catch (error) {
        // Transport causes may contain endpoint tokens. Keep their category,
        // not provider text/URLs, in the diagnostic chain.
        const cause = { type: error instanceof TypeError ? "TypeError" : "TransportError" };
        // eslint-disable-next-line preserve-caught-error -- Do not retain secret endpoint tokens in an upstream error.
        if (controller.signal.aborted) throw new Error("PUSH_DELIVERY_TIMEOUT", { cause });
        if (typeof (error as { statusCode?: unknown })?.statusCode === "number") throw error;
        // eslint-disable-next-line preserve-caught-error -- Preserve only the safe transport category, never upstream URLs.
        throw new Error("PUSH_TRANSPORT_FAILED", { cause });
      } finally {
        clearTimeout(timeout);
        controller.abort();
      }
    },
  };
}
