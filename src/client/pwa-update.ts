export type PwaUpdateState = "idle" | "available" | "updating" | "error";

/** Only the tab that explicitly accepted an update reloads. */
export function watchPwaUpdate(
  serviceWorker: ServiceWorkerContainer,
  registration: ServiceWorkerRegistration,
  publish: (state: PwaUpdateState) => void,
  reload: () => void,
) {
  let previousController = serviceWorker.controller;
  let offered: ServiceWorker | null = null;
  let accepted = false;
  let reloaded = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let activating: ServiceWorker | null = null;
  let activationListener: (() => void) | undefined;
  const clearActivation = () => {
    clearTimeout(timer); timer = undefined;
    if (activating && activationListener) activating.removeEventListener("statechange", activationListener);
    activating = null; activationListener = undefined;
  };
  const failActivation = () => {
    clearActivation(); accepted = false; publish("error");
  };
  const finishActivation = () => {
    if (!accepted || reloaded || !activating || serviceWorker.controller !== activating || activating.state !== "activated") return;
    reloaded = true; accepted = false; clearActivation(); reload();
  };
  const announce = () => {
    if (registration.waiting && serviceWorker.controller && registration.waiting !== serviceWorker.controller && !accepted) {
      offered = registration.waiting;
      publish("available");
    }
  };
  const observe = () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener("statechange", announce);
  };
  serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded) return;
    const unchangedController = serviceWorker.controller === previousController;
    const replacedController = !!previousController && serviceWorker.controller !== previousController;
    previousController = serviceWorker.controller;
    if (!accepted) {
      if (replacedController) { offered = serviceWorker.controller; publish("available"); }
      return;
    }
    if (serviceWorker.controller !== activating) {
      if (unchangedController) return;
      offered = serviceWorker.controller; failActivation(); return;
    }
    // Claiming a page can precede completion of the worker's activate event.
    // Keep the original watchdog and this page until that controller is ready.
    finishActivation();
  });
  registration.addEventListener("updatefound", observe);
  observe();
  announce();
  return () => {
    if (accepted || reloaded) return;
    const worker = registration.waiting ?? offered;
    if (worker && worker === serviceWorker.controller && worker.state === "activated") {
      reloaded = true;
      reload();
      return;
    }
    if (!worker || worker.state === "redundant") { publish("error"); return; }
    accepted = true;
    activating = worker;
    activationListener = () => {
      if (!accepted || activating !== worker) return;
      if (worker.state === "redundant") {
        if (offered === worker) offered = null;
        failActivation(); return;
      }
      finishActivation();
    };
    worker.addEventListener("statechange", activationListener);
    publish("updating");
    timer = setTimeout(failActivation, 15_000);
    try { worker.postMessage({ type: "TASKTOPIA_SKIP_WAITING" }); }
    catch { failActivation(); }
  };
}
