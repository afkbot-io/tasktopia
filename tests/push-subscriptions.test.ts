import { describe, expect, it } from "vitest";
import { normalizePushSubscription } from "../src/server/push-subscriptions";

const valid = {
  endpoint: "https://updates.push.services.mozilla.com/wpush/v2/example",
  expirationTime: null,
  keys: {
    p256dh: "BOr5I6ZBqj9iU2DKzZL6SXjZ1hP0vH2_aCNJjvW7f3OYPxLkbZJf0dQ5m2LFN5BkjP1KrMa_XPpxdtEbYqCVkX0",
    auth: "MDEyMzQ1Njc4OWFiY2RlZg",
  },
};

describe("push subscription contract", () => {
  it("accepts a bounded HTTPS endpoint and browser P-256/auth keys", () => {
    expect(normalizePushSubscription(valid)).toEqual(valid);
  });

  it.each([
    { ...valid, endpoint: "http://push.example.test/subscription" },
    { ...valid, endpoint: "https://user:secret@push.example.test/subscription" },
    { ...valid, keys: { ...valid.keys, auth: "not+base64" } },
    { ...valid, keys: { ...valid.keys, p256dh: "short" } },
  ])("rejects unsafe or malformed subscription material", (candidate) => {
    expect(() => normalizePushSubscription(candidate)).toThrow();
  });
});
