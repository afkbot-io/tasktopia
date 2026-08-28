import { useEffect, useState } from "react";
import { ApiError } from "../api";
import { disablePushNotifications, enablePushNotifications, readPushUiState, type PushUiState } from "../push-notifications";

export function PushNotificationCard({ compact = false, onDismiss }: { compact?: boolean; onDismiss?: () => void }) {
  const [state, setState] = useState<PushUiState | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void readPushUiState().then((next) => { if (active) setState(next); }).catch(() => {
      if (active) setError("Не удалось проверить состояние уведомлений");
    });
    return () => { active = false; };
  }, []);

  if (compact && (!state || state.kind !== "disabled")) return null;
  const actionable = state?.kind === "disabled" || state?.kind === "enabled";
  const toggle = async () => {
    if (!state || !actionable) return;
    setPending(true); setError("");
    try { setState(state.kind === "enabled" ? await disablePushNotifications() : await enablePushNotifications()); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : "Не удалось изменить настройку уведомлений"); }
    finally { setPending(false); }
  };

  return <section className={compact ? "push-card push-card-compact" : "settings-section push-card"} aria-labelledby={compact ? undefined : "push-title"}>
    {!compact && <div className="settings-section-heading"><div><h3 id="push-title">Push-уведомления</h3><p>Настройка действует отдельно для каждого браузера и устройства.</p></div></div>}
    <div className="push-card-body">
      <div><strong>{state?.kind === "enabled" ? "Уведомления включены" : "Не пропускайте изменения"}</strong><p>{state?.message ?? "Проверяем поддержку браузера…"}</p>{error && <p className="push-card-error" role="alert">{error}</p>}</div>
      {actionable && <button type="button" className={state?.kind === "enabled" ? "push-disable-button" : "primary-button"} disabled={pending} onClick={() => void toggle()}>{pending ? "Подождите…" : state?.kind === "enabled" ? "Отключить" : "Включить"}</button>}
      {compact && <button type="button" className="push-dismiss" aria-label="Скрыть предложение" onClick={onDismiss}>×</button>}
    </div>
  </section>;
}
