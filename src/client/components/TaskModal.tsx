import { useEffect, useRef, useState } from "react";
import { getBuilding } from "../../shared/catalog";
import type { TaskDocumentDto, TaskDto } from "../../shared/contracts";
import { api } from "../api";
import { Markdown } from "./Markdown";

const statusLabel: Record<TaskDto["status"], string> = {
  PLANNING: "Планирование", STARTED: "В работе · 0%", IN_PROGRESS: "В работе", TESTING: "Тестирование", COMPLETED: "Завершено",
};
const priorityLabel: Record<TaskDto["priority"], string> = { LOW: "Низкий", NORMAL: "Обычный", HIGH: "Высокий", CRITICAL: "Критический" };
const workItemLabel: Record<TaskDto["workItemType"], string> = { TASK: "Задача", BUG: "Баг", RELEASE: "Релиз", HOTFIX: "Хотфикс" };
const defectStatusLabel: Record<NonNullable<TaskDto["defects"]>[number]["status"], string> = {
  OPEN: "Зафиксирован", IN_PROGRESS: "Исправляется", VERIFYING: "Проверяется", FIXED: "Исправлен",
};
const eventLabel: Record<NonNullable<TaskDto["events"]>[number]["type"], string> = {
  CREATED: "Задача создана", TITLE_CHANGED: "Задача переименована", STATUS_CHANGED: "Изменён этап строительства", COMMENT_ADDED: "Добавлен комментарий", ASSIGNEE_CHANGED: "Изменён ответственный",
  FIELDS_UPDATED: "Обновлена постановка", DEFECT_CREATED: "Зафиксирован связанный дефект", DEFECT_UPDATED: "Обновлён связанный дефект",
  LINK_ADDED: "Добавлена ссылка на MR", LINK_REMOVED: "Удалена ссылка на MR", ATTACHMENT_ADDED: "Прикреплён файл",
  DOCUMENT_UPDATED: "Обновлён документ задачи", DOCUMENT_DELETED: "Удалён дополнительный документ",
  CHECKLIST_REPLACED: "Обновлён чек-лист", CHECKLIST_ITEM_UPDATED: "Обновлён пункт чек-листа",
};
const dateTime = (value: string) => new Date(value).toLocaleString("ru-RU", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
const fileSize = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} МБ` : bytes >= 1024 ? `${Math.round(bytes / 1024)} КБ` : `${bytes} Б`;

type TaskModalProps = {
  taskId: string;
  revision: number;
  onClose: () => void;
};

function DocumentShelf({ documents }: { documents: TaskDocumentDto[] }) {
  const firstFilled = documents.find((document) => document.content.trim());
  const [selectedId, setSelectedId] = useState<string | null>(firstFilled?.id ?? null);
  const selected = documents.find((document) => document.id === selectedId && document.content.trim());
  const filledCount = documents.filter((document) => document.content.trim()).length;

  useEffect(() => {
    if (!documents.some((document) => document.id === selectedId && document.content.trim())) {
      setSelectedId(documents.find((document) => document.content.trim())?.id ?? null);
    }
  }, [documents, selectedId]);

  return <section className="task-documents">
    <div className="task-section-title">
      <div><h3>Материалы для реализации</h3><p>Markdown-документы обновляются AI-агентами через MCP.</p></div>
      <span>{filledCount}/{documents.length || 4}</span>
    </div>
    <div className="task-document-shelf" role="tablist" aria-label="Документы задачи">
      {documents.map((document) => {
        const filled = Boolean(document.content.trim());
        return <button
          key={document.id}
          type="button"
          role="tab"
          aria-selected={selected?.id === document.id}
          className={`${filled ? "filled" : "empty"}${selected?.id === document.id ? " selected" : ""}`}
          disabled={!filled}
          onClick={() => setSelectedId(document.id)}
          title={filled ? `Открыть ${document.fileName}` : `${document.fileName} пока не заполнен`}
        >
          <i aria-hidden="true">MD</i>
          <span><strong>{document.title}</strong><small>{document.fileName}</small></span>
          <b aria-hidden="true">{filled ? "›" : "—"}</b>
        </button>;
      })}
    </div>
    {selected ? <article className="task-document-preview" role="tabpanel">
      <header><div><strong>{selected.title}</strong><code>{selected.fileName}</code></div><small>{selected.actor} · {dateTime(selected.updatedAt)}</small></header>
      <Markdown text={selected.content} />
    </article> : <p className="task-documents-empty">AI-агент ещё не заполнил материалы задачи.</p>}
  </section>;
}

export function TaskModal({ taskId, revision, onClose }: TaskModalProps) {
  const [task, setTask] = useState<TaskDto | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    setTask(null);
    void api<TaskDto>(`/api/tasks/${taskId}`).then((loaded) => { if (!cancelled) setTask(loaded); });
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { cancelled = true; window.removeEventListener("keydown", onKey); };
  }, [taskId, revision, onClose]);

  useEffect(() => {
    if (!task) return;
    const sharePath = `/task/${task.taskNumber}`;
    if (window.location.pathname !== sharePath) window.history.replaceState(null, "", sharePath);
    return () => { if (window.location.pathname === sharePath) window.history.replaceState(null, "", "/"); };
  }, [task]);

  const copyShareLink = async () => {
    if (!task) return;
    const url = `${window.location.origin}/task/${task.taskNumber}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1600);
    } catch { window.prompt("Ссылка на задачу:", url); }
  };

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section className="task-modal" role="dialog" aria-modal="true" aria-labelledby="task-title">
      <button ref={closeRef} className="modal-close" onClick={onClose} aria-label="Закрыть">×</button>
      {!task ? <div className="modal-loading">Загружаем задачу…</div> : <>
        <header className="task-header">
          <div className={`stage-icon stage-${task.stage}`}>{task.stage}</div>
          <div className="min-w-0"><p className="eyebrow">#{task.taskNumber} · {workItemLabel[task.workItemType]} · {getBuilding(task.buildingType).label} · {task.estimate} SP</p><h2 id="task-title">{task.title}</h2></div>
          <button className="task-share" onClick={() => void copyShareLink()} title="Скопировать ссылку на задачу">{linkCopied ? "Скопировано ✓" : "🔗 Ссылка"}</button>
        </header>
        <div className="task-status-row"><span className={`status-pill status-${task.status.toLowerCase()}`}>{statusLabel[task.status]}</span><div className="progress-track"><i style={{ width: `${task.progress}%` }} /></div><strong>{task.progress}%</strong></div>
        <div className="task-grid">
          <div><span>Приоритет</span><strong>{priorityLabel[task.priority]}</strong></div><div><span>Срок</span><strong>{task.dueAt ? new Date(task.dueAt).toLocaleDateString("ru-RU") : "Не задан"}</strong></div>
          <div><span>Создатель</span><strong>{task.creator?.name ?? "Система страны"}</strong></div><div><span>Ответственный</span><strong>{task.assignee?.name ?? "Не назначен"}</strong></div>
          <div><span>Создана</span><strong>{dateTime(task.createdAt)}</strong></div><div><span>Обновлена</span><strong>{dateTime(task.updatedAt)}</strong></div>
        </div>
        <section className="task-description"><h3>Описание</h3>{task.description ? <Markdown text={task.description} /> : <p>Описание пока не передано через MCP.</p>}</section>
        {task.acceptanceCriteria && <section className="task-description"><h3>Критерии приёмки</h3><Markdown text={task.acceptanceCriteria} /></section>}
        <DocumentShelf documents={task.documents ?? []} />
        <section className="task-checklist">
          <div className="task-section-title"><div><h3>Чек-лист</h3><p>Шаги реализации и их фактический прогресс.</p></div><span>{task.checklist?.filter((item) => item.done).length ?? 0}/{task.checklist?.length ?? 0}</span></div>
          {task.checklist?.length ? <ol>{task.checklist.map((item) => <li key={item.id} className={item.done ? "done" : ""}><i aria-hidden="true">{item.done ? "✓" : ""}</i><span>{item.title}</span></li>)}</ol> : <p className="muted">AI-агент пока не сформировал чек-лист.</p>}
        </section>
        {task.mergeRequests.length > 0 && <section className="task-links"><h3>Связанные MR <span>{task.mergeRequests.length}</span></h3><ul>{task.mergeRequests.map((link) => <li key={link.url}><a href={link.url} target="_blank" rel="noreferrer noopener">{link.title}</a><small>{link.actor} · {new Date(link.addedAt).toLocaleDateString("ru-RU")}</small></li>)}</ul></section>}
        {task.attachments?.length ? <section className="task-attachments"><h3>Файлы-доказательства <span>{task.attachments.length}</span></h3><ul>{task.attachments.map((attachment) => <li key={attachment.id}><a href={`/api/attachments/${attachment.id}`}>{attachment.fileName}</a><small>{fileSize(attachment.sizeBytes)} · {attachment.actor} · {new Date(attachment.createdAt).toLocaleDateString("ru-RU")}</small></li>)}</ul></section> : null}
        <section className="task-defects"><h3>Связанные дефекты <span>{task.defects?.filter((defect) => defect.status !== "FIXED").length ?? 0} активно</span></h3><p className="task-defect-hint">Исправление дефекта идёт отдельным циклом: прогресс задачи на тестировании не откатывается.</p>
          {task.defects?.length ? task.defects.map((defect) => <article key={defect.id} className={defect.status.toLowerCase()}><header><strong>{defect.title}</strong><span>{defectStatusLabel[defect.status]}</span></header>{defect.description && <Markdown text={defect.description} />}<dl><div><dt>Шаги</dt><dd>{defect.reproductionSteps}</dd></div><div><dt>Фактически</dt><dd>{defect.actualResult}</dd></div><div><dt>Ожидалось</dt><dd>{defect.expectedResult}</dd></div></dl></article>) : <p className="muted">Связанных дефектов нет.</p>}
        </section>
        <section className="comments"><h3>Ход работы</h3>{task.comments?.length ? task.comments.map((comment) => <article key={comment.id}><header className="comment-meta"><strong>{comment.actor}</strong><time>{new Date(comment.createdAt).toLocaleString("ru-RU")}</time></header><Markdown text={comment.body} /></article>) : <p className="muted">Комментариев пока нет.</p>}</section>
        <section className="task-history"><h3>Хроника задачи</h3>{task.events?.length ? task.events.map((event) => <article key={event.id}><i /><div><strong>{eventLabel[event.type]}</strong><span>{event.actor} · {new Date(event.createdAt).toLocaleString("ru-RU")}</span></div></article>) : <p className="muted">Хроника начнёт заполняться при следующем изменении.</p>}</section>
      </>}
    </section>
  </div>;
}
