import { watchPwaUpdate, type PwaUpdateState } from "./pwa-update";

let state: PwaUpdateState = "idle";
const listeners = new Set<() => void>();
let applyUpdate = () => {};
export const pwaUpdate = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  getSnapshot: () => state,
  apply: () => applyUpdate(),
};

export function registerTasktopiaServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator) || !window.isSecureContext) return;
  const register = async () => {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      applyUpdate = watchPwaUpdate(navigator.serviceWorker, registration, next => {
        state = next;
        for (const listener of listeners) listener();
      }, () => window.location.reload());
      let lastCheck = 0;
      const check = () => {
        if (document.visibilityState !== "visible" || !navigator.onLine || Date.now() - lastCheck < 60_000) return;
        lastCheck = Date.now();
        void registration.update().catch(() => undefined);
      };
      document.addEventListener("visibilitychange", check);
      window.addEventListener("online", check);
      window.setInterval(check, 30 * 60_000);
      check();
    } catch { /* Installation can be retried on the next launch while offline. */ }
  };
  // A lazily loaded entry may run after window.load has already fired.
  if (document.readyState === "complete") void register();
  else window.addEventListener("load", () => { void register(); }, { once: true });
}
