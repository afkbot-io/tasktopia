import { useEffect, useRef, useState } from "react";
import type { ReferenceCardDto } from "../../shared/contracts";
import { api } from "../api";
import { Markdown } from "./Markdown";

const kindLabel: Record<ReferenceCardDto["kind"], string> = { TEMPLATE: "Шаблон", CONVENTION: "Конвенция", CONTEXT: "Контекст" };
const kindClass: Record<ReferenceCardDto["kind"], string> = { TEMPLATE: "kind-template", CONVENTION: "kind-convention", CONTEXT: "kind-context" };

export function ReferenceCardModal({ cardId, onClose }: { cardId: string; onClose: () => void }) {
  const [card, setCard] = useState<ReferenceCardDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api<ReferenceCardDto>(`/api/reference-cards/${cardId}`)
      .then((loaded) => { if (!cancelled) setCard(loaded); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Не удалось загрузить карточку"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { cancelled = true; window.removeEventListener("keydown", onKey); };
  }, [cardId, onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className="task-modal reference-card-modal" role="dialog" aria-modal="true" aria-labelledby="reference-card-title">
        <button ref={closeRef} className="modal-close" onClick={onClose} aria-label="Закрыть">×</button>
        {loading && <div className="modal-loading">Загружаем справочник…</div>}
        {error && <p className="task-delete-error" role="alert">{error}</p>}
        {!loading && card && <>
          <header className="task-header">
            <span className={`reference-kind ${kindClass[card.kind]}`}>{kindLabel[card.kind]}</span>
            <div className="min-w-0">
              <p className="eyebrow">{card.tags.length > 0 ? card.tags.join(" · ") : "Стартовый город"}</p>
              <h2 id="reference-card-title">{card.title}</h2>
            </div>
          </header>
          <div className="task-description"><Markdown text={card.body} /></div>
          <div className="task-grid">
            <div><span>Создана</span><strong>{new Date(card.createdAt).toLocaleString("ru-RU")}</strong></div>
            <div><span>Обновлена</span><strong>{new Date(card.updatedAt).toLocaleString("ru-RU")}</strong></div>
          </div>
        </>}
      </section>
    </div>
  );
}
