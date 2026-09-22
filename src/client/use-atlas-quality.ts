import { useEffect, type RefObject } from "react";
import { AdaptiveWorldQuality } from "./adaptive-world-quality";
import { startVisibleAnimation } from "./visible-animation";
import { readWorldPreferences, subscribeWorldPreferences } from "./world-preferences";

/** SVG/CSS animations have no shared JS ticker. Sample once per visible frame,
 * outside React, only in AUTO mode and after the map has finished loading. */
export function useAtlasQuality(hostRef: RefObject<HTMLElement | SVGSVGElement | null>, ready: boolean) {
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const quality = new AdaptiveWorldQuality();
    let stop: (() => void) | undefined;
    const publish = () => {
      const preference = readWorldPreferences().quality;
      const value = preference === "ECONOMY" || preference === "AUTO" && quality.economy ? "ECONOMY" : "NORMAL";
      host.dataset.worldQuality = value;
      document.documentElement.dataset.worldQuality = value;
    };
    const reconcile = () => {
      stop?.(); stop = undefined;
      quality.sample(0, false);
      publish();
      if (ready && !readWorldPreferences().reduceMotion && !window.matchMedia("(prefers-reduced-motion: reduce)").matches && readWorldPreferences().quality === "AUTO") {
        stop = startVisibleAnimation((_timestamp, delta) => {
          const previous = quality.economy;
          quality.sample(delta, true);
          if (previous !== quality.economy) publish();
        });
      }
    };
    reconcile();
    const unsubscribe = subscribeWorldPreferences(reconcile);
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    motion.addEventListener("change", reconcile);
    return () => { stop?.(); unsubscribe(); motion.removeEventListener("change", reconcile); };
  }, [hostRef, ready]);
}
