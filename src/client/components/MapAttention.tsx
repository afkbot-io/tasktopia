import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { loadMapAttention } from "../map-attention-loader";
import { type MapAttentionMode, type MapAttentionTask } from "../../shared/map-attention";
import { MAP_ATTENTION_FILTERS, filterMapAttention, mapAttentionFilterLabel } from '../map-attention-filters';
import type { TaskListItemDto } from '../../shared/task-read-contracts';
import { TaskCatalogDialog } from './TaskCatalogDialog';
export function MapAttention({ countryId, cityId, userId, revision, onChange, onSelectTask }: {
  countryId: string; cityId: string; userId: string; revision: number; onChange: (value: { scope: string; ids: string[]; label?:string }) => void; onSelectTask?: (task:TaskListItemDto)=>void;
}) {
  const [modes, setModes] = useState<MapAttentionMode[]>([]);
  const [catalogOpen,setCatalogOpen]=useState(false);
  const [tasks, setTasks] = useState<MapAttentionTask[] | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [now, setNow] = useState(Date.now);
  const cached = useRef<{ key: string; fetchedAt: number; tasks: MapAttentionTask[] } | null>(null);
  const enabled = modes.length > 0;
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
    if (!modes.includes("OVERDUE") || !tasks) return;
    const time = Date.now();
    const deadlines = tasks.filter(task => task.status !== "COMPLETED" && task.dueAt && Date.parse(task.dueAt) > time).map(task => Date.parse(task.dueAt!));
    if (!deadlines.length) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(2_147_000_000, Math.max(1, Math.min(...deadlines) - time)));
    return () => clearTimeout(timer);
  }, [modes, tasks, now]);
  const matching=useMemo(()=>tasks?filterMapAttention(tasks,modes,now):[],[tasks,modes,now]);
  const label=mapAttentionFilterLabel(modes);
  useLayoutEffect(() => {
    onChange({scope,label,ids:matching.map(task=>task.id)});
  },[scope,label,matching,onChange]);
  return <>
    <nav className="map-attention" aria-label="Подсветка построек">
      {MAP_ATTENTION_FILTERS.map(([value,label])=><button key={value} aria-pressed={modes.includes(value)} onClick={()=>{setNow(Date.now());setModes(current=>current.includes(value)?current.filter(mode=>mode!==value):[...current,value]);}}>{label}</button>)}
      {enabled&&<button onClick={()=>setModes([])}>Сбросить фильтр</button>}
      {enabled&&<span role="status">{error?<button onClick={()=>setRetry(value=>value+1)}>Повторить загрузку</button>:tasks?`Найдено: ${matching.length}`:'Загрузка…'}</span>}
      {onSelectTask&&<button type="button" aria-haspopup="dialog" onClick={()=>setCatalogOpen(true)}>Список задач города</button>}
    </nav>
    {catalogOpen&&onSelectTask&&<TaskCatalogDialog countryId={countryId} cityId={cityId} userId={userId} revision={revision} onClose={()=>setCatalogOpen(false)} onSelectTask={onSelectTask} />}
  </>;
}
