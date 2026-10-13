import { useEffect, useRef, useState } from "react";
import type { ArchiveRecordDto } from "../../shared/contracts";
import { useDialogFocus } from "../use-dialog-focus";
import { api } from "../api";
import { Markdown } from "./Markdown";

const kindLabel: Record<ArchiveRecordDto["kind"], string> = {
  PROJECT: "Проект", REPOSITORY: "Репозиторий", ARCHITECTURE: "Архитектура",
  CONVENTION: "Правило", ENVIRONMENT: "Окружение", TEMPLATE: "Шаблон",
};

export function ArchiveRecordModal({ recordId, onClose }: { recordId: string; onClose: () => void }) {
  const [record, setRecord] = useState<ArchiveRecordDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus(dialogRef, { onClose });

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setRecord(null);
    void api<ArchiveRecordDto>(`/api/archive/records/${recordId}`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setRecord(value); })
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "Не удалось открыть запись архива");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [recordId, retry]);

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <article ref={dialogRef} className="task-modal archive-record-modal" role="dialog" aria-modal="true" aria-label={!record ? "Запись архива" : undefined} aria-labelledby={record ? "archive-record-title" : undefined}>
      <button className="modal-close" onClick={onClose} aria-label="Закрыть">×</button>
      {loading && <div className="modal-loading" role="status">Открываем запись архива…</div>}
      {error && <div className="task-load-state" role="alert"><p>{error}</p><button className="primary-button" onClick={() => setRetry(n => n + 1)}>Повторить</button></div>}
      {!loading && record && <>
        <header className="task-header"><span className={`reference-kind kind-${record.kind.toLowerCase()}`}>{kindLabel[record.kind]}</span><div className="min-w-0">
          <p className="eyebrow">{record.tags.length > 0 ? record.tags.join(" · ") : "Государственный архив"}</p>
          <h2 id="archive-record-title">{record.title}</h2>
        </div></header>
        {record.sourceUrl && <p className="archive-source"><a href={record.sourceUrl} target="_blank" rel="noreferrer">Открыть источник ↗</a></p>}
        <div className="task-description"><Markdown text={record.body || "Описание пока не добавлено."} /></div>
        <div className="task-grid archive-record-grid">
          <div><span>Создана</span><strong>{new Date(record.createdAt).toLocaleString("ru-RU")}</strong></div>
          <div><span>Обновлена</span><strong>{new Date(record.updatedAt).toLocaleString("ru-RU")}</strong></div>
        </div>
      </>}
    </article>
  </div>;
}
