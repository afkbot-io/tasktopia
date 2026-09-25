import { useEffect, useState } from "react";
import type { AtlasTransition } from "../atlas-navigation-transition";

const LEVEL_LABEL = { PLANET: "планету", CITY: "город" } as const;

/** A small status panel: no full-screen animated texture competing with WebGL. */
export function MapLevelTransition({ transition, onCancel }: { transition: AtlasTransition; onCancel?:()=>void }) {
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    setWaiting(false);
    const timer = setTimeout(() => setWaiting(true), 6000);
    return () => clearTimeout(timer);
  }, [transition.id]);
  const phase = transition.to === 'PLANET' ? 'Возвращаемся к карте мира'
    : transition.phase === 'PRELOAD' ? 'Получаем план города'
    : 'Готовим улицы и здания';
  return <div className="map-level-transition" data-from={transition.from} data-to={transition.to}
    data-phase={transition.phase}
    >
    <div className="map-transition-message">
      <div className="map-transition-city" aria-hidden="true"><i /><i /><i /></div>
      <div role="status" aria-live="polite">
        <strong>Открываем {transition.destinationName ? `«${transition.destinationName}»` : LEVEL_LABEL[transition.to]}…</strong>
        <p className="map-transition-phrase">{phase}</p>
      </div>
      {waiting && <p className="map-transition-wait">Первое открытие может занять больше времени.</p>}
      {onCancel && transition.to === 'CITY' && <button type="button" onClick={onCancel}>Вернуться на планету</button>}
    </div>
  </div>;
}
