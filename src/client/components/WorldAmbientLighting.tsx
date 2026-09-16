import { readWorldPreferences, subscribeWorldPreferences } from "../world-preferences";
import { useEffect } from "react";
import { readWorldLighting } from "../world-light-clock";

/** One nonvisual clock subscriber; labels/navigation retain their own contrast. */
export function WorldAmbientLighting() {
  useEffect(() => {
    const apply = () => {
      const light = readWorldLighting();

      document.documentElement.style.setProperty("--world-light-filter", `brightness(${light.brightness})`);
    };
    const preferencesChanged = () => {
      document.documentElement.dataset.worldQuality = readWorldPreferences().quality === "ECONOMY" ? "ECONOMY" : "NORMAL";
      apply();
    };
    const unsubscribe = subscribeWorldPreferences(preferencesChanged);
    preferencesChanged();
    const timer = window.setInterval(apply, 1000);
    document.addEventListener("visibilitychange", apply);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", apply);
      document.documentElement.style.removeProperty("--world-light-filter");
    };
  }, []);
  return null;
}
