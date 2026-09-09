import { afterEach, describe, expect, it, vi } from "vitest";
import { watchPwaUpdate } from "../src/client/pwa-update";

function setup(waiting = true, controlled = true) {
  const worker = Object.assign(new EventTarget(), { postMessage: vi.fn() });
  const sw = Object.assign(new EventTarget(), { controller: controlled ? {} : null });
  const registration = Object.assign(new EventTarget(), { waiting: waiting ? worker : null, installing: worker });
  const publish = vi.fn();
  const reload = vi.fn();
  const apply = watchPwaUpdate(sw as unknown as ServiceWorkerContainer, registration as unknown as ServiceWorkerRegistration, publish, reload);
  return { worker, sw, registration, publish, reload, apply };
}
afterEach(() => vi.useRealTimers());
describe("explicit PWA update", () => {
  it("announces an already waiting update and reloads once only after acceptance", () => {
    const x = setup();
    expect(x.publish).toHaveBeenLastCalledWith("available");
    x.sw.dispatchEvent(new Event("controllerchange"));
    expect(x.reload).not.toHaveBeenCalled();
    x.apply(); x.apply();
    expect(x.worker.postMessage).toHaveBeenCalledExactlyOnceWith({ type: "TASKTOPIA_SKIP_WAITING" });
    expect(x.reload).not.toHaveBeenCalled();
    x.sw.dispatchEvent(new Event("controllerchange"));
    x.sw.dispatchEvent(new Event("controllerchange"));
    expect(x.reload).toHaveBeenCalledTimes(1);
  });
  it("announces updates installed later, but never first installation", () => {
    const x = setup(false);
    x.registration.waiting = x.worker;
    x.worker.dispatchEvent(new Event("statechange"));
    expect(x.publish).toHaveBeenLastCalledWith("available");
    expect(setup(true, false).publish).not.toHaveBeenCalled();
  });
  it("offers a reload when another tab has already activated the update", () => {
    const x = setup();
    x.registration.waiting = null;
    Object.assign(x.worker, { state: "activated" });
    x.sw.controller = x.worker;
    x.sw.dispatchEvent(new Event("controllerchange"));
    expect(x.reload).not.toHaveBeenCalled();
    expect(x.publish).toHaveBeenLastCalledWith("available");
    x.apply();
    expect(x.reload).toHaveBeenCalledTimes(1);
    expect(x.worker.postMessage).not.toHaveBeenCalled();
  });
  it("lets the user retry a stalled activation without a delayed unsolicited reload", async () => {
    vi.useFakeTimers();
    const x = setup();
    x.apply();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(x.publish).toHaveBeenLastCalledWith("error");
    x.sw.dispatchEvent(new Event("controllerchange"));
    expect(x.reload).not.toHaveBeenCalled();
    x.apply();
    x.sw.dispatchEvent(new Event("controllerchange"));
    expect(x.reload).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
