import { useEffect } from "react";
import { readWorldLighting } from "../world-light-clock";

/** One nonvisual clock subscriber; labels/navigation retain their own contrast. */
export function WorldAmbientLighting() {
  useEffect(() => {
    const apply = () => {
      const light = readWorldLighting();
      document.documentElement.style.setProperty("--world-light-filter", `brightness(${light.brightness})`);
    };
    apply();
    const timer = window.setInterval(apply, 1000);
    document.addEventListener("visibilitychange", apply);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", apply);
      document.documentElement.style.removeProperty("--world-light-filter");
    };
  }, []);
  return null;
}
