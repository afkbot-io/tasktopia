import type { Page } from "@playwright/test";

/** Measure browser activation -> ready painted city, excluding driver polling. */
export async function armWarmCityTiming(page: Page): Promise<void> {
  await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>(".world-canvas")!;
    delete host.dataset.qaWarmReturnMs;
    const activate = (event: Event) => {
      if (!(event.target instanceof Element)) return;
      if (event instanceof KeyboardEvent && event.key !== "Enter" && event.key !== " ") return;
      const target = event.target.closest(".planet-city-targets [role=button], .planet-city-label, .map-level-nav button");
      if (!target) return;
      document.removeEventListener("click", activate, true);
      document.removeEventListener("keydown", activate, true);
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
    };
    document.addEventListener("click", activate, true);
    document.addEventListener("keydown", activate, true);
  });
}
