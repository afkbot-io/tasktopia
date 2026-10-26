import { GameTabs } from "./GameTabs";
import { useDialogFocus } from "../use-dialog-focus";
import { TaskSharePreview } from "./TaskSharePreview";
import { useEffect, useMemo, useRef, useState } from "react";
import { getBuilding } from "../../shared/catalog";
import { TASK_PARK_LABELS } from "../../shared/task-park-catalog";
import type { TaskDocumentDto, TaskDto } from "../../shared/contracts";
import type { TaskCardDto, TaskDocumentMetadataDto, TaskCollectionPageDto } from '../../shared/task-read-contracts';
import { loadTaskCard, peekTaskCard, loadTaskDocument, forgetTaskCard } from "../task-read-cache";
import { TaskCollectionSection } from './TaskCollectionSection';
import { taskLink } from "../task-navigation";
import { ApiError } from "../api";
import { Markdown } from "./Markdown";
import { presentTaskChanges } from '../task-history-presentation';
import { readTaskWithInvalidationRetry } from '../owned-read-cache';

const statusLabel: Record<TaskDto["status"], string> = {
  PLANNING: "В плане", STARTED: "В работе · 0%", IN_PROGRESS: "В работе", TESTING: "Приёмка", COMPLETED: "Завершено",
};
const priorityLabel: Record<TaskDto["priority"], string> = { LOW: "Низкий", NORMAL: "Обычный", HIGH: "Высокий", CRITICAL: "Критический" };
const workItemLabel: Record<TaskDto["workItemType"], string> = { TASK: "Строительство", BUG: "Ремонт", RELEASE: "Открытие", HOTFIX: "Срочный ремонт" };
const serviceLabel: Record<NonNullable<TaskDto["serviceRole"]>, string> = {
  SHOP: "Магазин", EDUCATION: "Школа / детский сад", MEDICAL: "Медицинский центр",
  FIRE: "Пожарная часть", POLICE: "Полиция", RAILWAY: "Железнодорожная станция", AIRPORT: "Аэропорт",
  CIVIC: "Администрация города", PORT: "Морской порт",
};
const parkLabel: Readonly<Record<string, string>> = TASK_PARK_LABELS;
const defectStatusLabel: Record<NonNullable<TaskDto["defects"]>[number]["status"], string> = {
  OPEN: "Зафиксирован", IN_PROGRESS: "Исправляется", VERIFYING: "Проверяется", FIXED: "Исправлен",
};
type TaskEventType = NonNullable<TaskDto["events"]>[number]["type"];
const buildingEventLabel: Record<TaskEventType, string> = {
  CREATED: "Здание заложено", TITLE_CHANGED: "Здание переименовано", STATUS_CHANGED: "Изменён этап строительства", COMMENT_ADDED: "К зданию добавлен комментарий", ASSIGNEE_CHANGED: "У здания изменён ответственный",
  FIELDS_UPDATED: "Обновлены параметры здания", DEFECT_CREATED: "У здания зафиксирована неисправность", DEFECT_UPDATED: "Обновлено состояние неисправности здания",
  LINK_ADDED: "Добавлена ссылка на MR", LINK_REMOVED: "Удалена ссылка на MR", ATTACHMENT_ADDED: "Прикреплён файл",
  DOCUMENT_UPDATED: "Обновлён документ задачи", DOCUMENT_DELETED: "Удалён дополнительный документ задачи",
  CHECKLIST_REPLACED: "Обновлён чек-лист", CHECKLIST_ITEM_UPDATED: "Обновлён пункт чек-листа",
};
const parkEventLabel: Record<TaskEventType, string> = {
  ...buildingEventLabel,
  CREATED: "Парк заложен", TITLE_CHANGED: "Парк переименован", STATUS_CHANGED: "Изменён этап благоустройства", COMMENT_ADDED: "К парку добавлен комментарий", ASSIGNEE_CHANGED: "У парка изменён ответственный",
  FIELDS_UPDATED: "Обновлены параметры парка", DEFECT_CREATED: "В парке зафиксирована неисправность", DEFECT_UPDATED: "Обновлено состояние неисправности парка",
};
const dateTime = (value: string) => new Date(value).toLocaleString("ru-RU", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
const fileSize = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} МБ` : bytes >= 1024 ? `${Math.round(bytes / 1024)} КБ` : `${bytes} Б`;

type TaskModalProps = {
  standalone?: boolean;
  countryId: string;
  taskId: string;
  revision: number;
  onClose: () => void;
  onAuthenticationRequired?: () => void;
  onShowDependencies?: (taskId: string) => void;
  onNavigateTask?: (taskId: string) => void;
  onTaskReady?: (task: TaskCardDto) => void;
};

function DocumentShelf({ documents, countryId, taskId, revision, onAuthenticationRequired }: {
  documents: TaskDocumentMetadataDto[]; countryId: string; taskId: string; revision: number; onAuthenticationRequired?: () => void;
}) {
  const firstFilled = documents.find((document) => document.isFilled);
  const [selectedId, setSelectedId] = useState<string | null>(firstFilled?.id ?? null);
  const selected = documents.find((document) => document.id === selectedId && document.isFilled);
  const [content, setContent] = useState<TaskDocumentDto | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!documents.some((document) => document.id === selectedId && document.isFilled)) {
      setSelectedId(documents.find((document) => document.isFilled)?.id ?? null);
    }
  }, [documents, selectedId]);

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    if (!selectedId) { setContent(null); return; }
    setContent(current => current?.id === selectedId ? current : null);
    void readTaskWithInvalidationRetry(controller.signal, () => loadTaskDocument(countryId, taskId, selectedId, controller.signal)).then(doc => { if (!controller.signal.aborted) setContent(doc); }).catch(reason => {
      if (controller.signal.aborted) return;
      if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) setContent(null);
      if (reason instanceof ApiError && [401, 403].includes(reason.status)) void Promise.resolve(onAuthenticationRequired?.()).catch(() => undefined);
      setError(reason instanceof Error ? reason.message : 'Не удалось открыть документ');
    });
    return () => controller.abort();
  }, [countryId, taskId, selectedId, selected?.updatedAt, revision, retry, onAuthenticationRequired]);

  return <section className="task-documents">
    <div className="task-document-shelf" role="tablist" aria-label="Документы задачи">
      {documents.map((document) => {
        const filled = document.isFilled;
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
    {error && <p className="task-refresh-error" role="alert">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Повторить</button></p>}
    {selected && content?.id === selected.id ? <article className="task-document-preview" role="tabpanel">
      <header><div><strong>{selected.title}</strong><code>{selected.fileName}</code></div><small>{selected.actor} · {dateTime(selected.updatedAt)}</small></header>
      <Markdown text={content.content} />
    </article> : selected && !error ? <p role="status">Открываем документ…</p> : !selected ? <p className="task-documents-empty">Материалы пока не добавлены.</p> : null}
  </section>;
}

export function TaskModal({ standalone = false, countryId, taskId, revision, onClose, onAuthenticationRequired, onShowDependencies, onNavigateTask, onTaskReady }: TaskModalProps) {
  const [task, setTask] = useState<TaskCardDto | null>(() => peekTaskCard(countryId, taskId) ?? null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [linkCopied, setLinkCopied] = useState(false);
  const [copyFallback, setCopyFallback] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const [tab,setTab] = useState<"overview"|"materials"|"discussion"|"history">("overview");
  const [visited, setVisited] = useState(() => new Set(["overview"]));
  const documentPage = useMemo<TaskCollectionPageDto<'documents'> | undefined>(() => task ? {
    kind: 'task.collection-page', version: 1, countryId, taskId, collection: 'documents', items: task.documentMetadata, nextCursor: task.documentsNextCursor,
  } : undefined, [countryId, taskId, task]);
  const collectionProps = { countryId, taskId, revision, onAuthenticationRequired };
  const changeTab = (next: typeof tab) => { setTab(next); setVisited(current => new Set([...current, next])); };
  useDialogFocus(dialogRef, { onClose });

  useEffect(() => {
    const controller = new AbortController();
    setTask(current => current?.id === taskId ? current : peekTaskCard(countryId, taskId) ?? null);
    setError("");
    void readTaskWithInvalidationRetry(controller.signal, () => loadTaskCard(countryId, taskId, controller.signal)).then((loaded) => { if (!controller.signal.aborted) setTask(loaded); })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        // A deleted/inaccessible task must not retain its detail body or write
        // actions. Keep the loaded card only for recoverable service failures.
        if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) setTask(null);
        if (reason instanceof ApiError && reason.status === 401) void Promise.resolve(onAuthenticationRequired?.()).catch(() => undefined);
        setError(reason instanceof Error ? reason.message : "Не удалось открыть задачу");
      });
    return () => controller.abort();
  }, [countryId, taskId, revision, retry, onClose, onAuthenticationRequired]);

  useEffect(() => {
    if (!task) return;
    onTaskReady?.(task);
  }, [task, onTaskReady]);

  const copyShareLink = async () => {
    if (!task) return;
    const url = `${window.location.origin}${taskLink(countryId, task)}`;
    setLinkCopied(false);
    try {
      await navigator.clipboard.writeText(url);
      setCopyFallback(false);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1600);
    } catch { setCopyFallback(true); }
  };

  return <div className={`modal-backdrop task-inspector-backdrop${standalone ? " task-entry-backdrop" : ""}`} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section ref={dialogRef} className="task-modal task-inspector" role="dialog" aria-modal="true" aria-labelledby={task ? "task-title" : undefined} aria-label={task ? undefined : error ? "Задача недоступна" : "Загрузка задачи"}>
      <button ref={closeRef} className="modal-close" onClick={onClose} aria-label="Закрыть" title={standalone ? "Закрыть и открыть город" : "Закрыть"}>×</button>
      {task && error && <p className="task-refresh-error" role="alert">{error} <button onClick={() => { forgetTaskCard(countryId, taskId); setRetry(value => value + 1); }}>Повторить</button></p>}
      {!task ? <div className="task-load-state" role={error ? "alert" : "status"}><strong>{error || "Загружаем задачу…"}</strong>{error && <button className="primary-button" onClick={() => { forgetTaskCard(countryId, taskId); setRetry(value => value + 1); }}>Повторить</button>}</div> : <>
        <header className="task-header" tabIndex={0} role="group" aria-label="Название и параметры задачи">
          <div className={`stage-icon stage-${task.stage}`}>{task.stage}</div>
          <div className="min-w-0"><p className="eyebrow">#{task.taskNumber} · {workItemLabel[task.workItemType]} · {task.serviceRole ? serviceLabel[task.serviceRole] : task.visualKind === "PARK" ? parkLabel[task.visualAssetKey] ?? "Парк" : getBuilding(task.buildingType).label} · <span title="Объём работ в условных единицах сложности (SP)">Объём: {task.estimate} SP</span></p><h2 id="task-title">{task.title}</h2></div>
        </header>
        <div className="task-actions" role="group" aria-label="Ссылки задачи">
          {standalone && <button className="task-action" onClick={onClose}>В город →</button>}
          <button className="task-action" onClick={() => void copyShareLink()} title="Скопировать ссылку на задачу">{linkCopied ? "Скопировано ✓" : "Ссылка"}</button>
          <TaskSharePreview key={`${countryId}:${task.id}`} countryId={countryId} task={task} />
          {copyFallback && <label className="task-link-fallback">
            <span id="task-link-label">Ссылка на задачу</span>
            <input readOnly value={`${window.location.origin}${taskLink(countryId, task)}`} onFocus={event => event.target.select()} aria-labelledby="task-link-label" aria-describedby="task-link-copy-hint" />
            <small id="task-link-copy-hint" role="status">Буфер обмена недоступен. Выделите и скопируйте ссылку из поля.</small>
          </label>}
        </div>
        <div className="task-status-row"><span className={`status-pill status-${task.status.toLowerCase()}`}>{statusLabel[task.status]}</span><div className="progress-track"><i style={{ width: `${task.progress}%` }} /></div><strong>{task.progress}%</strong></div>
        {task.counts.activeDefects > 0 && <button className="task-defect-alert" onClick={()=>{setTab("overview");requestAnimationFrame(()=>dialogRef.current?.querySelector(".task-defects")?.scrollIntoView({block:"start"}));}}>Нужен ремонт · {task.counts.activeDefects} деф.</button>}
        <GameTabs id="task-sections" value={tab} onChange={changeTab} tabs={[
          {id:"overview",label:"Задача"}, {id:"materials",label:"Материалы",count:task.counts.filledDocuments},
          {id:"discussion",label:"Обсуждение",count:task.counts.comments}, {id:"history",label:"История"},
        ]} />
        <div id="task-sections-overview-panel" role="tabpanel" tabIndex={0} aria-labelledby="task-sections-overview-tab" hidden={tab!=="overview"} className="task-tab-content">
        <div className="task-grid">
          <div><span>Приоритет</span><strong>{priorityLabel[task.priority]}</strong></div><div><span>Срок</span><strong>{task.dueAt ? new Date(task.dueAt).toLocaleDateString("ru-RU") : "Не задан"}</strong></div>
          <div><span>Создатель</span><strong>{task.creator?.name ?? "Tasktopia"}</strong></div><div><span>Ответственный</span><strong>{task.assignee?.name ?? "Не назначен"}</strong></div>
          <div><span>Создана</span><strong>{dateTime(task.createdAt)}</strong></div><div><span>Обновлена</span><strong>{dateTime(task.updatedAt)}</strong></div>
        </div>
        <section className="task-description"><h3>Описание</h3>{task.description ? <Markdown text={task.description} /> : <p>Описание пока не добавлено.</p>}</section>
        {task.acceptanceCriteria && <section className="task-description"><h3>Критерии приёмки</h3><Markdown text={task.acceptanceCriteria} /></section>}
        {task.counts.dependencies > 0 && <TaskCollectionSection {...collectionProps} collection="dependencies" total={task.counts.dependencies} label="Зависит от задач" empty="Зависимостей нет." className="task-description">
          {items => <><ul>{items.map(dependency => <li key={dependency.id}><a href={taskLink(countryId, dependency)} onClick={event => {
            if (onNavigateTask && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) { event.preventDefault(); onNavigateTask(dependency.id); }
          }}>#{dependency.taskNumber} · {dependency.title}</a><small> · {statusLabel[dependency.status]}</small></li>)}</ul>{onShowDependencies && <button onClick={() => onShowDependencies(task.id)}>Показать зависимости на карте</button>}</>}
        </TaskCollectionSection>}
        <TaskCollectionSection {...collectionProps} collection="checklist" total={task.counts.checklistTotal} label={`Чек-лист · ${task.counts.checklistDone}/${task.counts.checklistTotal}`} empty="Шаги пока не добавлены." className="task-checklist">
          {items => <ol>{items.map(item => <li key={item.id} className={item.done ? 'done' : ''}><i aria-hidden="true">{item.done ? '✓' : ''}</i><span>{item.title}</span></li>)}</ol>}
        </TaskCollectionSection>
        <TaskCollectionSection {...collectionProps} collection="defects" total={task.counts.defects} label={`Связанные дефекты · ${task.counts.activeDefects} активно`} empty="Связанных дефектов нет." className="task-defects">
          {items => items.map(defect => <article key={defect.id} className={defect.status.toLowerCase()}><header><strong>{defect.title}</strong><span>{defectStatusLabel[defect.status]}</span></header>{defect.description && <Markdown text={defect.description} />}<dl><div><dt>Шаги</dt><dd>{defect.reproductionSteps}</dd></div><div><dt>Фактически</dt><dd>{defect.actualResult}</dd></div><div><dt>Ожидалось</dt><dd>{defect.expectedResult}</dd></div></dl></article>)}
        </TaskCollectionSection>
        </div>
        <div id="task-sections-materials-panel" role="tabpanel" tabIndex={0} aria-labelledby="task-sections-materials-tab" hidden={tab!=="materials"} className="task-tab-content">
        {visited.has("materials") && <>
        <TaskCollectionSection {...collectionProps} collection="documents" total={task.counts.documents} seed={documentPage} label="Материалы для реализации" empty="Материалы пока не добавлены." className="task-documents">
          {items => <DocumentShelf documents={items} {...collectionProps} />}
        </TaskCollectionSection>
        {task.counts.mergeRequests > 0 && <TaskCollectionSection {...collectionProps} collection="mergeRequests" total={task.counts.mergeRequests} label="Связанные MR" empty="Связанных MR нет." className="task-links">
          {items => <ul>{items.map(link => <li key={link.url}><a href={link.url} target="_blank" rel="noreferrer noopener">{link.title}</a><small>{link.actor} · {new Date(link.addedAt).toLocaleDateString('ru-RU')}</small></li>)}</ul>}
        </TaskCollectionSection>}
        {task.counts.attachments > 0 && <TaskCollectionSection {...collectionProps} collection="attachments" total={task.counts.attachments} label="Файлы" empty="Файлов нет." className="task-attachments">
          {items => <ul>{items.map(attachment => <li key={attachment.id}><a href={`/api/attachments/${attachment.id}`}>{attachment.fileName}</a><small>{fileSize(attachment.sizeBytes)} · {attachment.actor} · {new Date(attachment.createdAt).toLocaleDateString('ru-RU')}</small></li>)}</ul>}
        </TaskCollectionSection>}
        </>}
        </div>
        <div id="task-sections-discussion-panel" role="tabpanel" tabIndex={0} aria-labelledby="task-sections-discussion-tab" hidden={tab!=="discussion"} className="task-tab-content">
        {visited.has("discussion") && <>
        <TaskCollectionSection {...collectionProps} collection="comments" total={task.counts.comments} label="Ход работы" empty="Комментариев пока нет." className="comments">
          {items => items.map(comment => <article key={comment.id}><header className="comment-meta"><strong>{comment.actor}</strong><time>{new Date(comment.createdAt).toLocaleString('ru-RU')}</time></header><Markdown text={comment.body} /></article>)}
        </TaskCollectionSection>
        </>}
        </div>
        <div id="task-sections-history-panel" role="tabpanel" tabIndex={0} aria-labelledby="task-sections-history-tab" hidden={tab!=="history"} className="task-tab-content">
        {visited.has("history") && <>
        <TaskCollectionSection {...collectionProps} collection="events" total={task.counts.events} label={`Хроника ${task.visualKind === 'PARK' ? 'парка' : 'здания'}`} empty="Хроника начнёт заполняться при следующем изменении." className="task-history">
          {items => items.map(event => <article key={event.id}><i /><div><strong>{(task.visualKind === 'PARK' ? parkEventLabel : buildingEventLabel)[event.type]}</strong>{presentTaskChanges(event).map(change => <p key={change.label} className="task-history-change"><b>{change.label}:</b> <span>{change.before}</span> → <span>{change.after}</span></p>)}<span>{event.actor} · {new Date(event.createdAt).toLocaleString('ru-RU')}</span></div></article>)}
        </TaskCollectionSection>
        </>}
        </div>
      </>}
    </section>
  </div>;
}
