import { useSyncExternalStore } from "react";
import { readWorldPreferences, serverWorldPreferences, setWorldPreferences, subscribeWorldPreferences, type WorldPreferences as Preferences } from "../world-preferences";
export function WorldPreferences() {
  const preferences = useSyncExternalStore(subscribeWorldPreferences, readWorldPreferences, serverWorldPreferences);
  return <details className="map-legend world-preferences">
    <summary aria-label="Вид карты" title="Вид карты">☼</summary>
    <div className="map-legend-panel">
      <strong>Вид карты</strong>
      <label>Освещение<select value={preferences.lighting} onChange={event => setWorldPreferences({ lighting: event.target.value as Preferences["lighting"] })}>
        <option value="REAL_TIME">Реальное время</option><option value="DAY">Всегда день</option>
      </select></label>
      <label>Детализация<select value={preferences.quality} onChange={event => setWorldPreferences({ quality: event.target.value as Preferences["quality"] })}>
        <option value="AUTO">Автоматически</option><option value="NORMAL">Обычная</option><option value="ECONOMY">Экономная</option>
      </select></label>
      <p>Экономный режим уменьшает число рабочих и анимацию облаков. Задачи и транспорт остаются на карте.</p>
    </div>
  </details>;
}
