import { createECDH, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import webPush from "web-push";
import { createWebPushGateway } from "../src/server/push-gateway";

const vapid = { subject: "mailto:tests@example.test", ...webPush.generateVAPIDKeys() };
const ecdh = createECDH("prime256v1"); ecdh.generateKeys();
const subscription = { endpoint: "https://fcm.googleapis.com/wp/test", expirationTime: null,
  keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") } };

describe("bounded reviewed-provider push transport (no network)", () => {
  beforeEach(() => {
    // Fail closed even while proving RED against the retired transport.
    vi.spyOn(webPush, "sendNotification").mockResolvedValue({ statusCode: 201, body: "", headers: {} });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("uses the library's encrypted request with no redirect following or unbounded body buffering", async () => {
    const cancel = vi.fn(async () => undefined);
    const fetch = vi.fn(async () => ({ status: 201, body: { cancel } }));
    vi.stubGlobal("fetch", fetch);
    expect(await createWebPushGateway(vapid)!.send(subscription, "private task title")).toEqual({ statusCode: 201 });
    expect(fetch).toHaveBeenCalledOnce();
    const [endpoint, init] = fetch.mock.calls[0]! as unknown as [string, RequestInit];
    expect(endpoint).toBe(subscription.endpoint);
    expect(init).toMatchObject({ method: "POST", redirect: "manual", signal: expect.any(AbortSignal) });
    expect(Buffer.from(init.body as Uint8Array).toString()).not.toContain("private task title");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("enforces a wall-clock deadline and aborts a provider that never supplies headers", async () => {
    vi.useFakeTimers();
    vi.mocked(webPush.sendNotification).mockImplementation(() => new Promise(() => undefined));
    let transportSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_endpoint: string, init: RequestInit) => new Promise((_resolve, reject) => {
      transportSignal = init.signal as AbortSignal;
      transportSignal.addEventListener("abort", () => reject(new Error("mock transport aborted")), { once: true });
    })));
    let outcome = "pending";
    void createWebPushGateway(vapid)!.send(subscription, "private").then(() => { outcome = "sent"; }, error => { outcome = error.message; });
    await vi.advanceTimersByTimeAsync(5_001);
    expect(outcome).toBe("PUSH_DELIVERY_TIMEOUT");
    expect(transportSignal?.aborted).toBe(true);
  });

  it("rejects persisted unsafe endpoints before encryption or outbound work", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(createWebPushGateway(vapid)!.send({ ...subscription, endpoint: "https://127.0.0.1/internal" }, "private"))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves provider status for terminal/retry handling without following redirects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 302, body: null })));
    await expect(createWebPushGateway(vapid)!.send(subscription, "private")).rejects.toMatchObject({ statusCode: 302 });
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 410, body: null })));
    await expect(createWebPushGateway(vapid)!.send(subscription, "private")).rejects.toMatchObject({ statusCode: 410 });
  });
});
