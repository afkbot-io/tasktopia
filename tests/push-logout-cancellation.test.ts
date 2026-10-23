import { afterEach, describe, expect, it, vi } from "vitest";
import { clearPushSubscriptionForLogout } from "../src/client/push-notifications";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => { resolve = finish; });
  return { promise, resolve };
}

function installPushBrowser() {
  const registrationGate = deferred<ServiceWorkerRegistration | undefined>();
  const subscriptionGate = deferred<PushSubscription | null>();
  const subscriptionStarted = deferred<void>();
  const unsubscribe = vi.fn(async () => true);
  const subscription = {
    endpoint: "https://push.example.test/logout-subscription",
    unsubscribe,
  } as unknown as PushSubscription;
  const getSubscription = vi.fn(() => {
    subscriptionStarted.resolve(undefined);
    return subscriptionGate.promise;
  });
  const registration = { pushManager: { getSubscription } } as unknown as ServiceWorkerRegistration;
  const getRegistration = vi.fn(() => registrationGate.promise);
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("navigator", { serviceWorker: { getRegistration } });
  vi.stubGlobal("window", { isSecureContext: true, PushManager: class {}, Notification: {} });
  vi.stubGlobal("fetch", fetchMock);
  return {
    registrationGate, subscriptionGate, subscriptionStarted,
    registration, subscription, getRegistration, getSubscription, unsubscribe, fetchMock,
  };
}

function allowCancellation(completion: Promise<void>, signal: AbortSignal): Promise<void> {
  return completion.catch(error => {
    if (error !== signal.reason) throw error;
  });
}

describe("logout push cleanup cancellation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(["registration", "subscription"] as const)(
    "does not delete or unsubscribe after cancellation while %s is pending",
    async held => {
      const browser = installPushBrowser();
      const controller = new AbortController();
      if (held === "registration") browser.subscriptionGate.resolve(browser.subscription);
      else browser.registrationGate.resolve(browser.registration);

      const completion = allowCancellation(clearPushSubscriptionForLogout(controller.signal), controller.signal);
      expect(browser.getRegistration).toHaveBeenCalledWith("/");
      if (held === "subscription") await browser.subscriptionStarted.promise;
      controller.abort(new DOMException("Logout timed out", "AbortError"));
      if (held === "registration") browser.registrationGate.resolve(browser.registration);
      else browser.subscriptionGate.resolve(browser.subscription);
      await completion;

      expect(browser.fetchMock).not.toHaveBeenCalled();
      expect(browser.unsubscribe).not.toHaveBeenCalled();
      if (held === "registration") expect(browser.getSubscription).not.toHaveBeenCalled();
    },
  );

  it("passes cancellation to DELETE and does not unsubscribe after a cancelled DELETE completes", async () => {
    const browser = installPushBrowser();
    const deleteStarted = deferred<void>();
    const deleteResponse = deferred<Response>();
    browser.fetchMock.mockImplementation(() => {
      deleteStarted.resolve(undefined);
      return deleteResponse.promise;
    });
    browser.registrationGate.resolve(browser.registration);
    browser.subscriptionGate.resolve(browser.subscription);
    const controller = new AbortController();
    const completion = allowCancellation(clearPushSubscriptionForLogout(controller.signal), controller.signal);
    await deleteStarted.promise;
    controller.abort(new DOMException("Logout timed out", "AbortError"));
    deleteResponse.resolve(new Response(null, { status: 204 }));
    await completion;

    expect(browser.fetchMock).toHaveBeenCalledTimes(1);
    expect(browser.fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      method: "DELETE", signal: controller.signal,
    }));
    expect(browser.unsubscribe).not.toHaveBeenCalled();
  });

  it("keeps successful cleanup without an optional signal", async () => {
    const browser = installPushBrowser();
    browser.registrationGate.resolve(browser.registration);
    browser.subscriptionGate.resolve(browser.subscription);

    await clearPushSubscriptionForLogout();

    expect(browser.fetchMock).toHaveBeenCalledTimes(1);
    expect(browser.fetchMock).toHaveBeenCalledWith("/api/push/subscriptions", expect.objectContaining({
      method: "DELETE", body: JSON.stringify({ endpoint: browser.subscription.endpoint }),
    }));
    expect(browser.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
