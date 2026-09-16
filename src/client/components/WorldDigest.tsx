import { useEffect, useRef, useState } from "react";
import type { WorldDigest as Digest } from "../../shared/world-digest";
import { api } from "../api";
import { establishDigestBaseline, readDigestCursor, rememberDigestCursor, worldDigestCursorKey } from "../world-digest-cursor";
const labels = { COMPLETED: "Завершено", DEFECT: "Новый дефект", OPENED: "Открыт объект инфраструктуры" };
export function WorldDigest({ userId, countryId, onTask }: { userId: string; countryId: string; onTask: (id: string) => void }) {
  const key = worldDigestCursorKey(userId, countryId);
  const [digest, setDigest] = useState<Digest | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const openRef = useRef(open);
  const shownAfter = useRef<number | null>(null);
  const hasDigest = useRef(false);
  useEffect(() => { openRef.current = open; hasDigest.current = digest !== null; }, [open, digest]);
  useEffect(() => {
    const controller = new AbortController();
    const storedCursor = readDigestCursor(key);
    const cursor = openRef.current && hasDigest.current ? shownAfter.current : storedCursor;
    setError(false);
    if (!openRef.current) setDigest(null);
    void api<Digest>(`/api/world-digest?countryId=${countryId}${cursor === null ? "" : `&after=${cursor}`}`, { signal: controller.signal })
      .then(value => {
        if (controller.signal.aborted) return;
        if (readDigestCursor(key) !== storedCursor) { setRefresh(n => n + 1); return; }
        if (value.baseline) void establishDigestBaseline(key, value.cursor, storedCursor);
        else { shownAfter.current = cursor; setDigest(value); }
      }).catch(() => { if (!controller.signal.aborted) { setDigest(null); setError(true); } });
    return () => controller.abort();
  }, [key, countryId, refresh]);
  useEffect(() => {
    const revisit = () => { if (!document.hidden) { setOpen(false); setRefresh(n => n + 1); } };
    const storage = (event: StorageEvent) => { if (event.key === key) revisit(); };
    window.addEventListener("online", revisit);
    window.addEventListener("storage", storage);
    document.addEventListener("visibilitychange", revisit);
    const timer = window.setInterval(() => { if (!document.hidden) setRefresh(n => n + 1); }, 60_000);
    return () => { window.removeEventListener("online", revisit); window.removeEventListener("storage", storage); document.removeEventListener("visibilitychange", revisit); clearInterval(timer); };
  }, [key]);
  useEffect(() => {
    if (!open || !digest || document.hidden) return;
    // Commit after the panel was painted, never merely after its HTTP response.
    let painted = 0;
    const frame = requestAnimationFrame(() => { painted = requestAnimationFrame(() => {
      if (!document.hidden) void rememberDigestCursor(key, digest.cursor);
    }); });
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(painted); };
  }, [open, digest, key]);
  const total = digest ? Object.values(digest.totals).reduce((a,b) => a+b,0) : 0;
  if (!error && total === 0) return null;
  return <aside className="world-digest">
    <button aria-expanded={open} onClick={() => setOpen(value => !value)}>С прошлого посещения{total > 0 ? ` · ${total}${digest?.truncated ? "+" : ""}` : ""}</button>
    {open && <section aria-label="С прошлого посещения">
      <div className="world-digest-heading"><strong>Изменения в стране</strong><button aria-label="Закрыть сводку" onClick={() => setOpen(false)}>×</button></div>
      {error ? <button onClick={() => setRefresh(n => n + 1)}>Повторить загрузку сводки</button> : digest && <>
        <p>Завершено: {digest.totals.COMPLETED} · Дефекты: {digest.totals.DEFECT} · Открытия: {digest.totals.OPENED}</p>
        <small>За последние {digest.periodDays} дней. До 20 карточек.{digest.truncated && " Учтены последние 1000 событий."}</small>
        <ul>{digest.items.map(item => <li key={`${item.taskId}:${item.kind}`}><button onClick={() => { setOpen(false); onTask(item.taskId); }}>
          <strong>№{item.taskNumber} · {item.title}</strong><span>{labels[item.kind]}{item.count > 1 ? ` · ${item.count}` : ""} · {item.cityName}</span>
        </button></li>)}</ul>
      </>}
    </section>}
  </aside>;
}
