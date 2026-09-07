import { useEffect, useRef } from "react";
import type { WorldFeatureDto } from "../../shared/contracts";
import { siteMarkerPresentation } from "../site-marker-presentation";
import { Button } from "./ui";

export function SiteHistoryModal({ feature, onClose, onTaskOpen }: {
  feature: WorldFeatureDto;
  onClose: () => void;
  onTaskOpen: (taskId: string) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => { previous?.focus(); };
  }, []);
  const marker = feature.siteMarker;
  if (!marker) return null;
  const presentation = siteMarkerPresentation(marker);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="task-modal site-history-modal" role="dialog" aria-modal="true" aria-labelledby="site-history-title" onKeyDown={(event) => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); }
      if (event.key !== "Tab") return;
      const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
      const first = buttons?.[0]; const last = buttons?.[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <button ref={closeRef} className="modal-close" onClick={onClose} aria-label="Закрыть историю участка">×</button>
      <p className="eyebrow">{presentation.badge} · постоянный участок</p>
      <h2 id="site-history-title">{presentation.heading}</h2>
      <h3>#{marker.snapshot.taskNumber} · {marker.snapshot.title}</h3>
      <p>{presentation.description}</p>
      <dl className="task-grid">
        <div><dt>Последняя стадия здесь</dt><dd>{marker.snapshot.lastStage} из 5</dd></div>
        <div><dt>Запись создана</dt><dd>{new Date(marker.snapshot.recordedAt).toLocaleString("ru-RU")}</dd></div>
      </dl>
      <p>Этот участок сохранён в истории города навсегда. Новые постройки здесь не размещаются.</p>
      {presentation.taskId ? <Button onClick={() => onTaskOpen(presentation.taskId!)}>Открыть текущую задачу</Button>
        : marker.kind === "RELOCATED" ? <p>Текущая задача больше недоступна. Сохранена только история участка.</p> : null}
    </section>
  </div>;
}
