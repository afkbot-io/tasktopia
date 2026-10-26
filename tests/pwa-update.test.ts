import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchPwaUpdate } from "../src/client/pwa-update";

const createWorker = (state: ServiceWorkerState) => Object.assign(new EventTarget(), { state, postMessage: vi.fn() });
type Worker = ReturnType<typeof createWorker>;
const changeState = (worker: Worker, state: ServiceWorkerState) => {
  worker.state = state;
  worker.dispatchEvent(new Event("statechange"));
};
function setup(waiting = true, controlled = true) {
  const worker = createWorker(waiting ? "installed" : "installing");
  const sw = Object.assign(new EventTarget(), { controller: controlled ? createWorker("activated") : null as Worker | null });
  const registration = Object.assign(new EventTarget(), {
    active: sw.controller, waiting: waiting ? worker : null as Worker | null, installing: waiting ? null : worker as Worker | null,
  });
  const publish = vi.fn();
  const reload = vi.fn();
  const apply = watchPwaUpdate(sw as unknown as ServiceWorkerContainer, registration as unknown as ServiceWorkerRegistration, publish, reload);
  const control = (next: Worker | null = worker) => {
    registration.waiting = null; registration.installing = null; registration.active = next; sw.controller = next;
    sw.dispatchEvent(new Event("controllerchange"));
  };
  return { worker, sw, registration, publish, reload, apply, control };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
describe("explicit PWA update", () => {
  it("announces an already waiting update and reloads once only after acceptance", () => {
    const x = setup();
    expect(x.publish).toHaveBeenLastCalledWith("available");
    x.sw.dispatchEvent(new Event("controllerchange"));
    expect(x.reload).not.toHaveBeenCalled();
    x.apply(); x.apply();
    expect(x.worker.postMessage).toHaveBeenCalledExactlyOnceWith({ type: "TASKTOPIA_SKIP_WAITING" });
    expect(x.reload).not.toHaveBeenCalled();
    x.worker.state = "activated";
    x.control();
    x.sw.dispatchEvent(new Event("controllerchange"));
    expect(x.reload).toHaveBeenCalledTimes(1);
  });
  it("announces updates installed later, but never first installation", () => {
    const x = setup(false);
    x.worker.state = "installed";
    x.registration.waiting = x.worker;
    x.registration.installing = null;
    x.worker.dispatchEvent(new Event("statechange"));
    expect(x.publish).toHaveBeenLastCalledWith("available");
    expect(setup(true, false).publish).not.toHaveBeenCalled();
  });
  it("ignores a controller notification for the worker already controlling this page", () => {
    const x = setup(false);
    x.sw.dispatchEvent(new Event("controllerchange"));
    expect(x.publish).not.toHaveBeenCalled();
  });
  it("does not offer the first worker during a waiting/controller transition", () => {
    const x = setup(false, false);
    x.worker.state = "activating";
    x.sw.controller = x.worker;
    x.registration.waiting = x.worker;
    x.worker.dispatchEvent(new Event("statechange"));
    expect(x.publish).not.toHaveBeenCalled();
  });
  it("tracks a later replacement after the first worker claims the page", () => {
    const x = setup(false, false);
    x.worker.state = "activated";
    x.control();
    expect(x.publish).not.toHaveBeenCalled();
    x.control(createWorker("activated"));
    expect(x.publish).toHaveBeenLastCalledWith("available");
  });
  it("offers a reload when another tab has already activated the update", () => {
    const x = setup();
    x.worker.state = "activated";
    x.control();
    expect(x.reload).not.toHaveBeenCalled();
    expect(x.publish).toHaveBeenLastCalledWith("available");
    x.apply();
    expect(x.reload).toHaveBeenCalledTimes(1);
    expect(x.worker.postMessage).not.toHaveBeenCalled();
  });
  it("lets the user retry a stalled activation without a delayed unsolicited reload", async () => {
    const x = setup();
    x.apply();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(x.publish).toHaveBeenLastCalledWith("error");
    x.worker.state = "activated";
    x.control();
    expect(x.reload).not.toHaveBeenCalled();
    x.apply();
    expect(x.reload).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for the accepted controller to activate without clearing its original deadline", async () => {
    const x = setup(); x.apply();
    x.worker.state = "activating"; x.control();
    expect(x.reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(x.publish).toHaveBeenLastCalledWith("updating");
    expect(x.reload).not.toHaveBeenCalled();
    changeState(x.worker, "activated");
    changeState(x.worker, "activated"); x.sw.dispatchEvent(new Event("controllerchange"));
    expect(x.reload).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not treat a notification from the unchanged old controller as the accepted update", () => {
    const x = setup(); x.apply();
    x.sw.dispatchEvent(new Event("controllerchange"));
    expect(x.reload).not.toHaveBeenCalled();
    x.worker.state = "activated"; x.control();
    expect(x.reload).toHaveBeenCalledTimes(1);
  });

  it("expires an activating controller after15s and requires explicit retry after its late activation", async () => {
    const x = setup(); x.apply();
    x.worker.state = "activating"; x.control();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(x.publish).toHaveBeenLastCalledWith("error");
    changeState(x.worker, "activated");
    expect(x.reload).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    x.apply();
    expect(x.reload).toHaveBeenCalledTimes(1);
    expect(x.worker.postMessage).toHaveBeenCalledTimes(1);
  });

  it.each(["replacement", "lost-controller"] as const)("releases an unmatched activation (%s) and ignores its stale worker", cause => {
    const x = setup(); x.apply();
    x.worker.state = "activating"; x.control();
    const other = cause === "replacement" ? createWorker("activating") : null;
    x.control(other);
    expect(x.publish).toHaveBeenLastCalledWith("error");
    expect(vi.getTimerCount()).toBe(0);
    changeState(x.worker, "activated");
    if (other) changeState(other, "activated");
    expect(x.reload).not.toHaveBeenCalled();
    if (other) { x.apply(); expect(x.reload).toHaveBeenCalledTimes(1); }
  });

  it("releases a redundant accepted controller without a late reload", () => {
    const x = setup(); x.apply();
    x.worker.state = "activating"; x.control();
    changeState(x.worker, "redundant");
    expect(x.publish).toHaveBeenLastCalledWith("error");
    expect(vi.getTimerCount()).toBe(0);
    expect(x.reload).not.toHaveBeenCalled();
  });
});
