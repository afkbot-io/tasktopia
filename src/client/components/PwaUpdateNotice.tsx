import { useSyncExternalStore } from "react";
import { pwaUpdate } from "../pwa";

export function PwaUpdateNotice() {
  const state = useSyncExternalStore(pwaUpdate.subscribe, pwaUpdate.getSnapshot);
  if (state === "idle") return null;
  return <aside className="pwa-update-notice" aria-label="Обновление приложения">
    <div role="status"><strong>{state === "error" ? "Не удалось обновить приложение" : "Доступна новая версия Tasktopia"}</strong>
      <p>{state === "updating" ? "Обновляем приложение…" : "Сохраните изменения перед обновлением. Карта откроется заново."}</p></div>
    <button type="button" disabled={state === "updating"} onClick={pwaUpdate.apply}>{state === "error" ? "Повторить обновление" : "Обновить"}</button>
  </aside>;
}
