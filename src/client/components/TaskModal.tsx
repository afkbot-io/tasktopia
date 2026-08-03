import { useEffect, useRef, useState } from "react";
import { getBuilding } from "../../shared/catalog";
import type { TaskDto } from "../../shared/contracts";
import { api } from "../api";

const statusLabel: Record<TaskDto["status"], string> = {
  PLANNING: "Планирование", STARTED: "В работе · 0%", IN_PROGRESS: "В работе", TESTING: "Тестирование", COMPLETED: "Завершено",
};
const priorityLabel: Record<TaskDto["priority"], string> = { LOW: "Низкий", NORMAL: "Обычный", HIGH: "Высокий", CRITICAL: "Критический" };
const platformLabel: Record<TaskDto["platformType"], string> = { YARD: "Двор", STONE: "Камень", ASPHALT: "Асфальт", SERVICE: "Служебная", PARK: "Парк" };
const eventLabel: Record<NonNullable<TaskDto["events"]>[number]["type"], string> = {
  CREATED: "Задача создана", STATUS_CHANGED: "Изменён этап строительства", COMMENT_ADDED: "Добавлен комментарий", ASSIGNEE_CHANGED: "Изменён ответственный",
};

export function TaskModal({ taskId, revision, onClose }: { taskId: string; revision: number; onClose: () => void }) {
  const [task, setTask] = useState<TaskDto | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    void api<TaskDto>(`/api/tasks/${taskId}`).then(setTask);
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [taskId, revision, onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className="task-modal" role="dialog" aria-modal="true" aria-labelledby="task-title">
        <button ref={closeRef} className="modal-close" onClick={onClose} aria-label="Закрыть">×</button>
        {!task ? <div className="modal-loading">Загружаем задачу…</div> : <>
          <header className="task-header">
            <div className={`stage-icon stage-${task.stage}`}>{task.stage}</div>
            <div><p className="eyebrow">{getBuilding(task.buildingType).label} · {task.estimate} SP</p><h2 id="task-title">{task.title}</h2></div>
          </header>
          <div className="task-status-row">
            <span className={`status-pill status-${task.status.toLowerCase()}`}>{statusLabel[task.status]}</span>
            <div className="progress-track"><i style={{ width: `${task.progress}%` }} /></div>
            <strong>{task.progress}%</strong>
          </div>
          <div className="task-grid">
            <div><span>Приоритет</span><strong>{priorityLabel[task.priority]}</strong></div>
            <div><span>Срок</span><strong>{task.dueAt ? new Date(task.dueAt).toLocaleDateString("ru-RU") : "Не задан"}</strong></div>
            <div><span>Платформа</span><strong>{platformLabel[task.platformType]}</strong></div>
            <div><span>Площадь</span><strong>{task.footprint.length} клеток</strong></div>
            <div><span>Создатель</span><strong>{task.creator?.name ?? "Система страны"}</strong></div>
            <div><span>Ответственный</span><strong>{task.assignee?.name ?? "Не назначен"}</strong></div>
          </div>
          <section className="task-description"><h3>Описание</h3><p>{task.description || "Описание пока не передано через MCP."}</p></section>
          <section className="comments"><h3>Ход работы</h3>
            {task.comments?.length ? task.comments.map((comment) => <article key={comment.id}><div><strong>{comment.actor}</strong><time>{new Date(comment.createdAt).toLocaleString("ru-RU")}</time></div><p>{comment.body}</p></article>) : <p className="muted">Комментариев пока нет.</p>}
          </section>
          <section className="task-history"><h3>Хроника задачи</h3>
            {task.events?.length ? task.events.map((event) => <article key={event.id}><i /><div><strong>{eventLabel[event.type]}</strong><span>{event.actor} · {new Date(event.createdAt).toLocaleString("ru-RU")}</span></div></article>) : <p className="muted">Хроника начнёт заполняться при следующем изменении.</p>}
          </section>
        </>}
      </section>
    </div>
  );
}
