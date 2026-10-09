import { Component, useRef, useState, type ReactNode } from "react";
import { useDialogFocus } from "../use-dialog-focus";

async function reloadInterface() {
  // WebKit can retain a failed modulepreload across a normal navigation. Refresh
  // only unsuccessful public modules before resetting React's rejected lazy import.
  const resources = new Map(performance.getEntriesByType("resource").map(entry => [entry.name, entry as PerformanceResourceTiming]));
  const failed = [...document.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"]')].filter(link => {
    const resource = resources.get(link.href);
    return resource && resource.decodedBodySize === 0;
  });
  await Promise.allSettled(failed.map(async link => {
    const response = await fetch(link.href, {
      cache: "reload", signal: AbortSignal.timeout(5_000),
      credentials: link.crossOrigin === "use-credentials" ? "include" : "same-origin",
    });
    await response.arrayBuffer();
  }));
  location.reload();
}

function ReloadInterfaceButton() {
  const [pending, setPending] = useState(false);
  return <button type="button" className="primary-button" disabled={pending} aria-busy={pending} onClick={() => {
    setPending(true); void reloadInterface();
  }}>{pending ? "Перезагружаем…" : "Перезагрузить"}</button>;
}

export function DialogLoadState({ label, onClose, error = false }: { label: string; onClose: () => void; error?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  useDialogFocus(ref, { onClose });
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={ref} className="ui-load-dialog" role="dialog" aria-modal="true" aria-label={error ? "Не удалось открыть окно" : label}>
      <button className="modal-close" type="button" aria-label="Закрыть" onClick={onClose}>×</button>
      <div className="ui-load-state" role={error ? "alert" : "status"}>
        {!error && <span className="loader-square" aria-hidden="true" />}
        <strong>{error ? "Не удалось открыть окно" : `${label}…`}</strong>
        {error && <><p>Не удалось загрузить интерфейс. Перезагрузите страницу и попробуйте снова.</p><ReloadInterfaceButton /></>}
      </div>
    </section>
  </div>;
}

export function PanelLoadState({ onClose, error = false }: { onClose: () => void; error?: boolean }) {
  return <aside className="city-development-panel" aria-label="Развитие города" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <header><h2>Развитие города</h2><button type="button" autoFocus onClick={onClose} aria-label="Закрыть развитие города">×</button></header>
    <p role={error ? "alert" : "status"}>{error ? "Не удалось загрузить интерфейс." : "Открываем развитие города…"}</p>
    {error && <ReloadInterfaceButton />}
  </aside>;
}

/** A rejected lazy chunk must leave a closable screen instead of unmounting the app. */
export class UiLoadBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
