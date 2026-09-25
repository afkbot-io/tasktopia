import type { CSSProperties } from "react";
import type { AtlasTransition } from "../atlas-navigation-transition";

const PHRASES = ["Сверяем городской план", "Ищем вашу стройплощадку", "Диспетчер готовит карту кварталов", "Проверяем адреса городских объектов", "Прокладываем путь через облака"];
const LEVEL_LABEL = { PLANET: "планету", CITY: "город" } as const;


export function MapLevelTransition({ transition, onCancel }: { transition: AtlasTransition; onCancel?:()=>void }) {
  const phrase = PHRASES[transition.phraseIndex ?? 0];
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
    <div className="map-transition-message"><span>Открываем {LEVEL_LABEL[transition.to]}…</span><small className="map-transition-phrase" aria-hidden="true">{phrase}</small>{onCancel && transition.to === "CITY" && <button type="button" onClick={onCancel}>Вернуться на планету</button>}</div>
  </div>;
}
