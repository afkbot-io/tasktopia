import { useSyncExternalStore } from "react";
import { readWorldPreferences, serverWorldPreferences, setWorldPreferences, subscribeWorldPreferences, type WorldPreferences as Preferences } from "../world-preferences";
export function WorldPreferences() {
  const preferences = useSyncExternalStore(subscribeWorldPreferences, readWorldPreferences, serverWorldPreferences);
  return <details className="map-legend world-preferences">
    <summary aria-label="Вид карты" title="Вид карты">⚙</summary>
    <div className="map-legend-panel">
      <strong>Вид карты</strong>
      <label>Детализация<select value={preferences.quality} onChange={event => setWorldPreferences({ quality: event.target.value as Preferences["quality"] })}>
        <option value="AUTO">Автоматически</option><option value="NORMAL">Полная</option><option value="ECONOMY">Экономная</option>
      </select></label>
      <label className="preference-check"><input type="checkbox" checked={preferences.cityLife} onChange={event=>setWorldPreferences({cityLife:event.target.checked})} />Жизнь города</label>
      <label className="preference-check"><input type="checkbox" checked={preferences.reduceMotion} onChange={event=>setWorldPreferences({reduceMotion:event.target.checked})} />Уменьшить движение</label>
      <p>Экономная детализация уменьшает количество прохожих, машин и эффектов. Все здания, состояния задач и маршруты доступны.</p>
      <p>«Жизнь города» управляет фоновыми сценами у готовых домов. Уменьшение движения также учитывает настройки устройства.</p>
    </div>
  </details>;
}
