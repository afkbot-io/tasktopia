import { useState, useSyncExternalStore } from "react";
import { pwaUpdate } from "../pwa";

export function PwaUpdateNotice() {
  const state = useSyncExternalStore(pwaUpdate.subscribe, pwaUpdate.getSnapshot);
  const [deferred, setDeferred] = useState(false);
  if (deferred || state === "idle") return null;
  return <aside className="pwa-update-notice" aria-label="Обновление приложения">
    <div role="status"><strong>{state === "error" ? "Не удалось обновить приложение" : "Доступна новая версия Tasktopia"}</strong>
      <p>{state === "updating" ? "Обновляем приложение…" : "Сохраните изменения перед обновлением. Карта откроется заново."}</p></div>
    <div className="pwa-update-actions">
    <button type="button" disabled={state === "updating"} onClick={pwaUpdate.apply}>{state === "error" ? "Повторить обновление" : "Обновить"}</button>
    <button type="button" disabled={state === "updating"} onClick={() => setDeferred(true)}>Позже</button>
    </div>
  </aside>;
}
