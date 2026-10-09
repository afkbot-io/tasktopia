import { useRef } from "react";
import { useDialogFocus } from "../use-dialog-focus";
import type { WorldFeatureDto } from "../../shared/contracts";
import { siteMarkerPresentation } from "../site-marker-presentation";

export function SiteHistoryModal({ feature, onClose }: {
  feature: WorldFeatureDto;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus(dialogRef, { onClose });
  const marker = feature.siteMarker;
  if (!marker) return null;
  const presentation = siteMarkerPresentation();
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="task-modal site-history-modal" role="dialog" aria-modal="true" aria-labelledby="site-history-title">
      <button className="modal-close" onClick={onClose} aria-label="Закрыть историю участка">×</button>
      <p className="eyebrow">{presentation.badge} · постоянный участок</p>
      <h2 id="site-history-title">{presentation.heading}</h2>
      <h3>#{marker.snapshot.taskNumber} · {marker.snapshot.title}</h3>
      <p>{presentation.description}</p>
      <dl className="task-grid">
        <div><dt>Последняя стадия здесь</dt><dd>{marker.snapshot.lastStage} из 5</dd></div>
        <div><dt>Запись создана</dt><dd>{new Date(marker.snapshot.recordedAt).toLocaleString("ru-RU")}</dd></div>
      </dl>
      <p>Этот участок сохранён в истории города навсегда. Новые постройки здесь не размещаются.</p>

    </section>
  </div>;
}
