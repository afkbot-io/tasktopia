import webPush from "web-push";
import type { BrowserPushSubscription } from "./push-subscriptions";

export type PushSendResult = { statusCode: number };
export type PushGateway = {
  send(subscription: BrowserPushSubscription, payload: string): Promise<PushSendResult>;
};

export type VapidConfig = { subject: string; publicKey: string; privateKey: string };

export function createWebPushGateway(vapid: VapidConfig | undefined): PushGateway | undefined {
  if (!vapid) return undefined;
  webPush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  return {
    async send(subscription, payload) {
      const response = await webPush.sendNotification(subscription, payload, {
        TTL: 300,
        urgency: "normal",
      });
      return { statusCode: response.statusCode };
    },
  };
}
