import { readWorldPreferences, subscribeWorldPreferences } from "./world-preferences";

/** One owned frame loop, stopped while hidden or when reduced motion is requested.
 * The first resumed frame has zero delta: background time is not animation work. */
export function startVisibleAnimation(render: (timestamp: number, deltaMs: number) => void) {
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0;
  let previous: number | null = null;
  let disposed = false;
  const tick = (timestamp: number) => {
    frame = 0;
    if (disposed || document.hidden || motion.matches || readWorldPreferences().reduceMotion) return;
    const delta = previous === null ? 0 : timestamp - previous;
    previous = timestamp;
    render(timestamp, delta);
    if (!disposed) frame = requestAnimationFrame(tick);
  };
  const reconcile = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    previous = null;
    if (!disposed && !document.hidden && !motion.matches && !readWorldPreferences().reduceMotion) frame = requestAnimationFrame(tick);
  };
  document.addEventListener("visibilitychange", reconcile);
  motion.addEventListener("change", reconcile);
  const unsubscribe = subscribeWorldPreferences(reconcile);
  reconcile();
  return () => {
    disposed = true;
    if (frame) cancelAnimationFrame(frame);
    document.removeEventListener("visibilitychange", reconcile);
    motion.removeEventListener("change", reconcile);
    unsubscribe();
  };
}
