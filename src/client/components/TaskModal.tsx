import { useEffect, useRef, useState } from "react";
import { getBuilding } from "../../shared/catalog";
import type { TaskDto } from "../../shared/contracts";
import { api } from "../api";
import { Button } from "./ui";

const statusLabel: Record<TaskDto["status"], string> = {
  PLANNING: "Планирование", STARTED: "В работе · 0%", IN_PROGRESS: "В работе", TESTING: "Тестирование", COMPLETED: "Завершено",
};
const priorityLabel: Record<TaskDto["priority"], string> = { LOW: "Низкий", NORMAL: "Обычный", HIGH: "Высокий", CRITICAL: "Критический" };
const platformLabel: Record<TaskDto["platformType"], string> = { YARD: "Двор", STONE: "Камень", ASPHALT: "Асфальт", SERVICE: "Служебная", PARK: "Парк" };
const workItemLabel: Record<TaskDto["workItemType"], string> = { TASK: "Задача", BUG: "Баг", RELEASE: "Релиз", HOTFIX: "Хотфикс" };
const defectStatusLabel: Record<NonNullable<TaskDto["defects"]>[number]["status"], string> = {
  OPEN: "Зафиксирован",
  IN_PROGRESS: "Исправляется",
  VERIFYING: "Проверяется",
  FIXED: "Исправлен",
};
const eventLabel: Record<NonNullable<TaskDto["events"]>[number]["type"], string> = {
  CREATED: "Задача создана", TITLE_CHANGED: "Задача переименована", STATUS_CHANGED: "Изменён этап строительства", COMMENT_ADDED: "Добавлен комментарий", ASSIGNEE_CHANGED: "Изменён ответственный",
  FIELDS_UPDATED: "Обновлена постановка", DEFECT_CREATED: "Зафиксирован связанный дефект", DEFECT_UPDATED: "Обновлён связанный дефект",
};

export function TaskModal({ taskId, revision, canEdit, onClose, onDeleted }: { taskId: string; revision: number; canEdit: boolean; onClose: () => void; onDeleted: () => Promise<void> }) {
  const [task, setTask] = useState<TaskDto | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    void api<TaskDto>(`/api/tasks/${taskId}`).then(setTask);
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [taskId, revision, onClose]);
  const removeTask = async () => {
    if (!task) return;
    const confirmation = window.prompt(`Удаление задачи нельзя отменить. Введите точное название:\n${task.title}`);
    if (confirmation == null) return;
    setDeleteError(""); setDeleting(true);
    try {
      await api(`/api/tasks/${task.id}`, { method: "DELETE", json: { confirmTitle: confirmation, idempotencyKey: crypto.randomUUID() } });
      onClose();
      await onDeleted();
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : "Не удалось удалить задачу");
    } finally { setDeleting(false); }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className="task-modal" role="dialog" aria-modal="true" aria-labelledby="task-title">
        <button ref={closeRef} className="modal-close" onClick={onClose} aria-label="Закрыть">×</button>
        {!task ? <div className="modal-loading">Загружаем задачу…</div> : <>
          <header className="task-header">
            <div className={`stage-icon stage-${task.stage}`}>{task.stage}</div>
            <div><p className="eyebrow">{workItemLabel[task.workItemType]} · {getBuilding(task.buildingType).label} · {task.estimate} SP</p><h2 id="task-title">{task.title}</h2></div>
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
          {task.acceptanceCriteria && <section className="task-description"><h3>Критерии приёмки</h3><p>{task.acceptanceCriteria}</p></section>}
          <section className="task-ai-fields"><h3>Материалы для реализации</h3>
            <div><strong>Системный анализ</strong><p>{task.systemAnalysis || "Не заполнен"}</p></div>
            <div><strong>Архитектура</strong><p>{task.architecture || "Не заполнена"}</p></div>
            <div><strong>Дизайн-система</strong><p>{task.designSystem || "Не требуется или не заполнена"}</p></div>
            <div><strong>План</strong><p>{task.implementationPlan || "Не заполнен"}</p></div>
          </section>
          <section className="task-defects"><h3>Связанные дефекты <span>{task.defects?.filter((defect) => defect.status !== "FIXED").length ?? 0} активно</span></h3>
            <p className="task-defect-hint">Исправление дефекта идёт отдельным циклом: прогресс задачи на тестировании не откатывается.</p>
            {task.defects?.length ? task.defects.map((defect) => <article key={defect.id} className={defect.status.toLowerCase()}>
              <header><strong>{defect.title}</strong><span>{defectStatusLabel[defect.status]}</span></header>
              {defect.description && <p>{defect.description}</p>}
              <dl><div><dt>Шаги</dt><dd>{defect.reproductionSteps}</dd></div><div><dt>Фактически</dt><dd>{defect.actualResult}</dd></div><div><dt>Ожидалось</dt><dd>{defect.expectedResult}</dd></div></dl>
            </article>) : <p className="muted">Связанных дефектов нет.</p>}
          </section>
          <section className="comments"><h3>Ход работы</h3>
            {task.comments?.length ? task.comments.map((comment) => <article key={comment.id}><div><strong>{comment.actor}</strong><time>{new Date(comment.createdAt).toLocaleString("ru-RU")}</time></div><p>{comment.body}</p></article>) : <p className="muted">Комментариев пока нет.</p>}
          </section>
          <section className="task-history"><h3>Хроника задачи</h3>
            {task.events?.length ? task.events.map((event) => <article key={event.id}><i /><div><strong>{eventLabel[event.type]}</strong><span>{event.actor} · {new Date(event.createdAt).toLocaleString("ru-RU")}</span></div></article>) : <p className="muted">Хроника начнёт заполняться при следующем изменении.</p>}
          </section>
          {canEdit && <section className="task-danger-zone">
            <div><h3>Удаление задачи</h3><p>Здание исчезнет, а участок снова станет доступен для новых задач.</p></div>
            <Button variant="danger" disabled={deleting} onClick={() => void removeTask()}>{deleting ? "Удаляем…" : "Удалить задачу"}</Button>
            {deleteError && <p className="task-delete-error" role="alert">{deleteError}</p>}
          </section>}
        </>}
      </section>
    </div>
  );
}
