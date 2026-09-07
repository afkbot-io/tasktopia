import type { Page } from "@playwright/test";

/** Measure browser click -> ready painted city, excluding driver polling. */
export async function armWarmCityTiming(page: Page): Promise<void> {
  await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>(".world-canvas")!;
    const button = document.querySelector<HTMLElement>(".country-overview-city")!;
    delete host.dataset.qaWarmReturnMs;
    button.addEventListener("click", () => {
      const started = performance.now();
      const ready = () => host.dataset.mapActive === "true"
        && host.dataset.citySceneCommit === "atomic"
        && host.dataset.groundBakeQueue === "0"
        && !document.querySelector(".map-level-transition");
      const sample = () => {
        if (!ready()) { requestAnimationFrame(sample); return; }
        // A second frame includes a paint opportunity after the ready state.
        requestAnimationFrame(() => {
          if (!ready()) { sample(); return; }
          host.dataset.qaWarmReturnMs = String(performance.now() - started);
        });
      };
      requestAnimationFrame(sample);
    }, { capture: true, once: true });
  });
}
