import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { loadMapAttention } from "../map-attention-loader";
import { matchesMapAttention, type MapAttentionMode, type MapAttentionTask } from "../../shared/map-attention";
const MODES: [MapAttentionMode, string][] = [["MINE", "Мои объекты"], ["TESTING", "Приёмка"], ["DEFECTS", "Нужен ремонт"], ["OVERDUE", "Срыв сроков"]];
export function MapAttention({ countryId, cityId, userId, revision, onChange }: {
  countryId: string; cityId: string; userId: string; revision: number; onChange: (value: { scope: string; ids: string[]; label?:string }) => void;
}) {
  const [mode, setMode] = useState<MapAttentionMode | null>(null);
  const [tasks, setTasks] = useState<MapAttentionTask[] | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [now, setNow] = useState(Date.now);
  const cached = useRef<{ key: string; fetchedAt: number; tasks: MapAttentionTask[] } | null>(null);
  const enabled = mode !== null;
  const scope = `${userId}:${countryId}:${cityId}`;
  useEffect(() => {
    if (!enabled) return;
    const key = JSON.stringify([userId, countryId, cityId, revision, retry]);
    const previous = cached.current;
    if (previous?.key === key && Date.now() - previous.fetchedAt < 60_000) {
      setTasks(previous.tasks); setError(false);
      return;
    }
    cached.current = null;
    const controller = new AbortController();
    setTasks(null); setError(false);
    void loadMapAttention(countryId, cityId, controller.signal)
      .then(all => { if (!controller.signal.aborted) {
        cached.current = { key, fetchedAt: Date.now(), tasks: all };
        setTasks(all);
      } })
      .catch(() => { if (!controller.signal.aborted) { setTasks(null); setError(true); } });
    return () => controller.abort();
  // Off/on and switching filters reuse the scoped revision for at most one minute.
  // Events, retries and access revalidation invalidate it; camera never does.
  }, [countryId, cityId, userId, revision, retry, enabled]);
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => { if (document.visibilityState === "visible") { setTasks(null); setRetry(n => n + 1); setNow(Date.now()); } };
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    // Revalidate access even if membership was revoked without a world event.
    const timer = window.setInterval(refresh, 60_000);
    return () => { window.removeEventListener("online", refresh); document.removeEventListener("visibilitychange", refresh); clearInterval(timer); };
  }, [enabled]);
  useEffect(() => {
    if (mode !== "OVERDUE" || !tasks) return;
    const time = Date.now();
    const deadlines = tasks.filter(task => task.status !== "COMPLETED" && task.dueAt && Date.parse(task.dueAt) > time).map(task => Date.parse(task.dueAt!));
    if (!deadlines.length) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(2_147_000_000, Math.max(1, Math.min(...deadlines) - time)));
    return () => clearTimeout(timer);
  }, [mode, tasks, now]);
  useLayoutEffect(() => {
    onChange({ scope, label:MODES.find(([value])=>value===mode)?.[1], ids: mode && tasks ? tasks.filter(task => matchesMapAttention(task, mode, now)).map(task => task.id) : [] });
  }, [scope, mode, tasks, now, onChange]);
  const count = mode && tasks ? tasks.filter(task => matchesMapAttention(task, mode, now)).length : 0;
  return <nav className="map-attention" aria-label="Подсветка построек">
    {MODES.map(([value, label]) => <button key={value} aria-pressed={mode === value} onClick={() => { setNow(Date.now()); setMode(mode === value ? null : value); }}>{label}</button>)}
    {mode && <button onClick={()=>setMode(null)}>Сбросить фильтр</button>}
    {mode && <span role="status">{error ? <button onClick={() => setRetry(n => n + 1)}>Повторить загрузку</button> : tasks ? `Найдено: ${count}` : "Загрузка…"}</span>}
  </nav>;
}
