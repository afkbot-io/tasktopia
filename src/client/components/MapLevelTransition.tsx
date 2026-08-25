import type { CSSProperties } from "react";
import type { AtlasTransition } from "../atlas-navigation-transition";

const LEVEL_LABEL = { PLANET: "планету", COUNTRY: "страну", CITY: "город" } as const;
const PHASE_LABEL = { PRELOAD: "Загружаем данные", PREPARE: "Готовим сцену", FIRST_FRAME: "Проверяем первый кадр", SWAP: "Открываем", EVICT: "Освобождаем ресурсы" } as const;

export function MapLevelTransition({ transition }: { transition: AtlasTransition }) {
  return <div
    className="map-level-transition"
    data-from={transition.from}
    data-to={transition.to}
    role="status"
    aria-live="polite"
    style={{
      "--map-transition-x": `${transition.focus.x * 100}%`,
      "--map-transition-y": `${transition.focus.y * 100}%`,
      "--map-transition-duration": `${transition.durationMs}ms`,
    } as CSSProperties}
  >
    <div className="map-level-transition-pixels" aria-hidden="true" />
    <div className="map-level-transition-focus" aria-hidden="true"><i /><i /><i /></div>
    <span>{PHASE_LABEL[transition.phase]}: {LEVEL_LABEL[transition.to]}…</span>
  </div>;
}
