import { useEffect, useRef, useState } from "react";
import { getBuilding } from "../../shared/catalog";
import type { TaskDto } from "../../shared/contracts";
import { api } from "../api";
import { Markdown } from "./Markdown";
import { Button } from "./ui";

const statusLabel: Record<TaskDto["status"], string> = {
  PLANNING: "Планирование", STARTED: "В работе · 0%", IN_PROGRESS: "В работе", TESTING: "Тестирование", COMPLETED: "Завершено",
};
const priorityLabel: Record<TaskDto["priority"], string> = { LOW: "Низкий", NORMAL: "Обычный", HIGH: "Высокий", CRITICAL: "Критический" };
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
  LINK_ADDED: "Добавлена ссылка на MR", LINK_REMOVED: "Удалена ссылка на MR", ATTACHMENT_ADDED: "Прикреплён файл",
};
const dateTime = (value: string) => new Date(value).toLocaleString("ru-RU", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
const fileSize = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} МБ` : bytes >= 1024 ? `${Math.round(bytes / 1024)} КБ` : `${bytes} Б`;

export function TaskModal({ taskId, revision, canEdit, onClose, onDeleted }: { taskId: string; revision: number; canEdit: boolean; onClose: () => void; onDeleted: () => Promise<void> }) {
  const [task, setTask] = useState<TaskDto | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [linkSaving, setLinkSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    void api<TaskDto>(`/api/tasks/${taskId}`).then((loaded) => { if (!cancelled) setTask(loaded); });
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { cancelled = true; window.removeEventListener("keydown", onKey); };
  }, [taskId, revision, onClose]);

  // The task card owns a shareable URL: opening it reflects in the address
  // bar, closing returns to the map root.
  useEffect(() => {
    if (!task) return;
    const sharePath = `/task/${task.taskNumber}`;
    if (window.location.pathname !== sharePath) window.history.replaceState(null, "", sharePath);
    return () => { if (window.location.pathname === sharePath) window.history.replaceState(null, "", "/"); };
  }, [task]);

  const reload = async () => setTask(await api<TaskDto>(`/api/tasks/${taskId}`));
  const reportError = (reason: unknown, fallback: string) => setActionError(reason instanceof Error ? reason.message : fallback);

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

  const addLink = async () => {
    if (!task || !linkUrl.trim()) return;
    setActionError(""); setLinkSaving(true);
    try {
      await api(`/api/tasks/${task.id}/links`, { method: "POST", json: { url: linkUrl.trim(), title: linkTitle.trim() || undefined, idempotencyKey: crypto.randomUUID() } });
      setLinkUrl(""); setLinkTitle("");
      await reload();
    } catch (reason) { reportError(reason, "Не удалось добавить ссылку"); }
    finally { setLinkSaving(false); }
  };

  const removeLink = async (url: string) => {
    if (!task) return;
    setActionError("");
    try {
      await api(`/api/tasks/${task.id}/links`, { method: "DELETE", json: { url, idempotencyKey: crypto.randomUUID() } });
      await reload();
    } catch (reason) { reportError(reason, "Не удалось удалить ссылку"); }
  };

  const uploadFile = async (file: File) => {
    if (!task) return;
    setActionError(""); setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
        reader.readAsDataURL(file);
      });
      await api(`/api/tasks/${task.id}/attachments`, {
        method: "POST",
        json: { fileName: file.name, mimeType: file.type || undefined, contentBase64: dataUrl.slice(dataUrl.indexOf(",") + 1), idempotencyKey: crypto.randomUUID() },
      });
      await reload();
    } catch (reason) { reportError(reason, "Не удалось прикрепить файл"); }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = ""; }
  };

  const removeAttachment = async (attachmentId: string) => {
    setActionError("");
    try {
      await api(`/api/attachments/${attachmentId}`, { method: "DELETE", json: { idempotencyKey: crypto.randomUUID() } });
      await reload();
    } catch (reason) { reportError(reason, "Не удалось удалить файл"); }
  };

  const copyShareLink = async () => {
    if (!task) return;
    const url = `${window.location.origin}/task/${task.taskNumber}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1600);
    } catch {
      window.prompt("Ссылка на задачу:", url);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className="task-modal" role="dialog" aria-modal="true" aria-labelledby="task-title">
        <button ref={closeRef} className="modal-close" onClick={onClose} aria-label="Закрыть">×</button>
        {!task ? <div className="modal-loading">Загружаем задачу…</div> : <>
          <header className="task-header">
            <div className={`stage-icon stage-${task.stage}`}>{task.stage}</div>
            <div className="min-w-0">
              <p className="eyebrow">#{task.taskNumber} · {workItemLabel[task.workItemType]} · {getBuilding(task.buildingType).label} · {task.estimate} SP</p>
              <h2 id="task-title">{task.title}</h2>
            </div>
            <button className="task-share" onClick={() => void copyShareLink()} title="Скопировать ссылку на задачу">{linkCopied ? "Скопировано ✓" : "🔗 Ссылка"}</button>
          </header>
          <div className="task-status-row">
            <span className={`status-pill status-${task.status.toLowerCase()}`}>{statusLabel[task.status]}</span>
            <div className="progress-track"><i style={{ width: `${task.progress}%` }} /></div>
            <strong>{task.progress}%</strong>
          </div>
          <div className="task-grid">
            <div><span>Приоритет</span><strong>{priorityLabel[task.priority]}</strong></div>
            <div><span>Срок</span><strong>{task.dueAt ? new Date(task.dueAt).toLocaleDateString("ru-RU") : "Не задан"}</strong></div>
            <div><span>Создатель</span><strong>{task.creator?.name ?? "Система страны"}</strong></div>
            <div><span>Ответственный</span><strong>{task.assignee?.name ?? "Не назначен"}</strong></div>
            <div><span>Создана</span><strong>{dateTime(task.createdAt)}</strong></div>
            <div><span>Обновлена</span><strong>{dateTime(task.updatedAt)}</strong></div>
          </div>
          <section className="task-description"><h3>Описание</h3>
            {task.description ? <Markdown text={task.description} /> : <p>Описание пока не передано через MCP.</p>}
          </section>
          {task.acceptanceCriteria && <section className="task-description"><h3>Критерии приёмки</h3><Markdown text={task.acceptanceCriteria} /></section>}
          <section className="task-ai-fields"><h3>Материалы для реализации</h3>
            <div><strong>Системный анализ</strong>{task.systemAnalysis ? <Markdown text={task.systemAnalysis} /> : <p>Не заполнен</p>}</div>
            <div><strong>Архитектура</strong>{task.architecture ? <Markdown text={task.architecture} /> : <p>Не заполнена</p>}</div>
            <div><strong>Дизайн-система</strong>{task.designSystem ? <Markdown text={task.designSystem} /> : <p>Не требуется или не заполнена</p>}</div>
            <div><strong>План</strong>{task.implementationPlan ? <Markdown text={task.implementationPlan} /> : <p>Не заполнен</p>}</div>
          </section>
          <section className="task-links"><h3>Связанные MR <span>{task.mergeRequests.length}</span></h3>
            {task.mergeRequests.length > 0 && <ul>
              {task.mergeRequests.map((link) => <li key={link.url}>
                <a href={link.url} target="_blank" rel="noreferrer noopener">{link.title}</a>
                <small>{link.actor} · {new Date(link.addedAt).toLocaleDateString("ru-RU")}</small>
                {canEdit && <button className="task-link-remove" onClick={() => void removeLink(link.url)} aria-label="Удалить ссылку">×</button>}
              </li>)}
            </ul>}
            {canEdit && <div className="task-link-form">
              <input value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="https://gitlab.example.com/repo/-/merge_requests/1" inputMode="url" />
              <input value={linkTitle} onChange={(event) => setLinkTitle(event.target.value)} placeholder="Подпись (необязательно)" />
              <Button disabled={linkSaving || !linkUrl.trim()} onClick={() => void addLink()}>{linkSaving ? "Добавляем…" : "Добавить"}</Button>
            </div>}
          </section>
          <section className="task-attachments"><h3>Файлы <span>{task.attachments?.length ?? 0}</span></h3>
            {task.attachments && task.attachments.length > 0 && <ul>
              {task.attachments.map((attachment) => <li key={attachment.id}>
                <a href={`/api/attachments/${attachment.id}`}>{attachment.fileName}</a>
                <small>{fileSize(attachment.sizeBytes)} · {attachment.actor} · {new Date(attachment.createdAt).toLocaleDateString("ru-RU")}</small>
                {canEdit && <button className="task-link-remove" onClick={() => void removeAttachment(attachment.id)} aria-label="Удалить файл">×</button>}
              </li>)}
            </ul>}
            {canEdit && <div className="task-attachment-form">
              <input ref={fileInputRef} type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadFile(file); }} />
              {uploading && <small>Загружаем файл…</small>}
            </div>}
          </section>
          {actionError && <p className="task-delete-error" role="alert">{actionError}</p>}
          <section className="task-defects"><h3>Связанные дефекты <span>{task.defects?.filter((defect) => defect.status !== "FIXED").length ?? 0} активно</span></h3>
            <p className="task-defect-hint">Исправление дефекта идёт отдельным циклом: прогресс задачи на тестировании не откатывается.</p>
            {task.defects?.length ? task.defects.map((defect) => <article key={defect.id} className={defect.status.toLowerCase()}>
              <header><strong>{defect.title}</strong><span>{defectStatusLabel[defect.status]}</span></header>
              {defect.description && <Markdown text={defect.description} />}
              <dl><div><dt>Шаги</dt><dd>{defect.reproductionSteps}</dd></div><div><dt>Фактически</dt><dd>{defect.actualResult}</dd></div><div><dt>Ожидалось</dt><dd>{defect.expectedResult}</dd></div></dl>
            </article>) : <p className="muted">Связанных дефектов нет.</p>}
          </section>
          <section className="comments"><h3>Ход работы</h3>
            {task.comments?.length ? task.comments.map((comment) => <article key={comment.id}><div><strong>{comment.actor}</strong><time>{new Date(comment.createdAt).toLocaleString("ru-RU")}</time></div><Markdown text={comment.body} /></article>) : <p className="muted">Комментариев пока нет.</p>}
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
