import { useEffect, useState } from "react";
import type { TaskDto } from "../../shared/contracts";
import type { MapDependencySelection } from "../map-dependencies";
import { loadTaskDetail, forgetTaskDetail } from "../task-detail-cache";
export function MapDependencies({ countryId, taskId, revision, scope, onChange, onClose }: {
  countryId: string; taskId: string; revision: number; scope: string;
  onChange: (data: { scope: string; selection?: MapDependencySelection }) => void; onClose: () => void;
}) {
  const [task, setTask] = useState<TaskDto>();
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const revalidate = () => { if (document.visibilityState === "visible") { forgetTaskDetail(countryId, taskId); setRefresh(n => n + 1); } };
    window.addEventListener("online", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    const timer = window.setInterval(revalidate, 60_000);
    return () => { clearInterval(timer); window.removeEventListener("online", revalidate); document.removeEventListener("visibilitychange", revalidate); };
  }, [countryId, taskId]);
  useEffect(() => {
    let active = true;
    setTask(undefined); setError(false); onChange({ scope });
    void loadTaskDetail(countryId, taskId).then(task => {
      if (!active) return;
      setTask(task);
      onChange({ scope, selection: { sourceId: task.id, targetIds: (task.dependencies ?? []).map(d => d.id) } });
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [countryId, taskId, revision, refresh, scope, onChange]);
  return <aside className="map-dependencies" aria-label="Зависимости выбранной задачи">
    <span>{error ? "Не удалось обновить зависимости" : task ? `#${task.taskNumber}: зависит от ${(task.dependencies ?? []).map(d => `#${d.taskNumber}`).join(", ") || "нет зависимостей"}` : "Загрузка зависимостей…"}</span>
    <small>Линии показывают связи зданий в текущем городе.</small>
    <button onClick={onClose} aria-label="Скрыть зависимости">×</button>
  </aside>;
}
