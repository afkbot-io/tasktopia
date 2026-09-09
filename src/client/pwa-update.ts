export type PwaUpdateState = "idle" | "available" | "updating" | "error";

/** Only the tab that explicitly accepted an update reloads. */
export function watchPwaUpdate(
  serviceWorker: ServiceWorkerContainer,
  registration: ServiceWorkerRegistration,
  publish: (state: PwaUpdateState) => void,
  reload: () => void,
) {
  const wasControlled = !!serviceWorker.controller;
  let offered: ServiceWorker | null = null;
  let accepted = false;
  let reloaded = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const announce = () => {
    if (registration.waiting && serviceWorker.controller && !accepted) {
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
    if (!accepted) {
      if (wasControlled) { offered = serviceWorker.controller; publish("available"); }
      return;
    }
    reloaded = true;
    clearTimeout(timer);
    reload();
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
    if (!worker) { publish("error"); return; }
    accepted = true;
    publish("updating");
    timer = setTimeout(() => { accepted = false; publish("error"); }, 15_000);
    try { worker.postMessage({ type: "TASKTOPIA_SKIP_WAITING" }); }
    catch { clearTimeout(timer); accepted = false; publish("error"); }
  };
}
