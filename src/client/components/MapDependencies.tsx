import { useEffect, useState } from "react";
import type { TaskCardDto } from "../../shared/task-read-contracts";
import type { MapDependencySelection } from "../map-dependencies";
import { loadTaskCard, forgetTaskCard } from "../task-read-cache";
import { useTaskCollectionPage } from "./TaskCollectionSection";
import { readTaskWithInvalidationRetry } from '../owned-read-cache';
export function MapDependencies({ countryId, taskId, revision, scope, onChange, onClose }: {
  countryId: string; taskId: string; revision: number; scope: string;
  onChange: (data: { scope: string; selection?: MapDependencySelection }) => void; onClose: () => void;
}) {
  const [task, setTask] = useState<TaskCardDto>();
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const dependencies = useTaskCollectionPage({ countryId, taskId, collection: "dependencies", total: task?.counts.dependencies ?? 0, revision: revision + refresh });
  useEffect(() => {
    const revalidate = () => { if (document.visibilityState === "visible") { forgetTaskCard(countryId, taskId); setRefresh(n => n + 1); } };
    window.addEventListener("online", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    const timer = window.setInterval(revalidate, 60_000);
    return () => { clearInterval(timer); window.removeEventListener("online", revalidate); document.removeEventListener("visibilitychange", revalidate); };
  }, [countryId, taskId]);
  useEffect(() => {
    const controller = new AbortController();
    setTask(undefined); setError(false);
    void readTaskWithInvalidationRetry(controller.signal, () => loadTaskCard(countryId, taskId, controller.signal))
      .then(task => { if (!controller.signal.aborted) setTask(task); }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [countryId, taskId, revision, refresh]);
  useEffect(() => {
    onChange({ scope, selection: task && dependencies.page ? { sourceId: task.id, targetIds: dependencies.page.items.map(item => item.id) } : undefined });
  }, [task, dependencies.page, scope, onChange]);
  return <aside className="map-dependencies" aria-label="Зависимости выбранной задачи">
    <span>{error || dependencies.error ? "Не удалось обновить зависимости" : task && !dependencies.busy ? `#${task.taskNumber}: зависит от ${dependencies.page?.items.map(d => `#${d.taskNumber}`).join(", ") || "нет зависимостей"}` : "Загрузка зависимостей…"}</span>
    <small>Линии показывают связи выбранной страницы в текущем городе.</small>
    {(error || dependencies.error) && <button onClick={() => { forgetTaskCard(countryId, taskId); setRefresh(value => value + 1); dependencies.retry(); }}>Повторить</button>}
    {(dependencies.hasPrevious || dependencies.page?.nextCursor) && <nav aria-label="Страницы зависимостей"><button disabled={!dependencies.hasPrevious || dependencies.busy} onClick={dependencies.previous}>Назад</button><span>{dependencies.pageNumber}</span><button disabled={!dependencies.page?.nextCursor || dependencies.busy} onClick={dependencies.next}>Далее</button></nav>}
    <button onClick={onClose} aria-label="Скрыть зависимости">×</button>
  </aside>;
}
