import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { loadMapAttention } from "../map-attention-loader";
import { type MapAttentionMode, type MapAttentionTask } from "../../shared/map-attention";
import { MAP_ATTENTION_FILTERS, filterMapAttention, mapAttentionFilterLabel } from '../map-attention-filters';
import { TASK_SPRINT_BADGES } from '../task-focus-presentation';
import type { TaskListItemDto } from '../../shared/task-read-contracts';
import { TaskCatalogDialog } from './TaskCatalogDialog';

export type MapAttentionSelection = { scope: string; ids: string[]; label?: string; active: boolean };
type AttentionResult = { key: string; fetchedAt: number; tasks: MapAttentionTask[] };
const SPRINT_BADGES = Object.values(TASK_SPRINT_BADGES).map(badge => {
  const colors = new Map<number, string[]>();
  for (const pixel of badge.pixels) {
    const path = colors.get(pixel.color) ?? [];
    path.push(`M${pixel.x} ${pixel.y}h1v1h-1z`);
    colors.set(pixel.color, path);
  }
  return { ...badge, paths: [...colors].map(([color, segments]) => ({ color, d: segments.join('') })) };
});

export function MapAttention({ countryId, cityId, userId, revision, onChange, onSelectTask }: {
  countryId: string; cityId: string; userId: string; revision: number; onChange: (value: MapAttentionSelection) => void; onSelectTask?: (task:TaskListItemDto)=>void;
}) {
  const [modes, setModes] = useState<MapAttentionMode[]>([]);
  const [catalogOpen,setCatalogOpen]=useState(false);
  const [loaded, setLoaded] = useState<AttentionResult | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [now, setNow] = useState(Date.now);
  const cached = useRef<AttentionResult | null>(null);
  const enabled = modes.length > 0;
  const scope = `${userId}:${countryId}:${cityId}`;
  const key = JSON.stringify([userId, countryId, cityId, revision, retry]);
  // A previous revision must not briefly dim the new city while its metadata
  // request starts. Loading, failures and an expired cache leave the map intact.
  const tasks = loaded?.key === key && now - loaded.fetchedAt < 60_000 ? loaded.tasks : null;
  useEffect(() => {
    if (!enabled) return;
    const previous = cached.current;
    if (previous?.key === key && Date.now() - previous.fetchedAt < 60_000) {
      setLoaded(previous); setError(false);
      return;
    }
    cached.current = null;
    const controller = new AbortController();
    setLoaded(null); setError(false);
    void loadMapAttention(countryId, cityId, controller.signal)
      .then(all => { if (!controller.signal.aborted) {
        const result = { key, fetchedAt: Date.now(), tasks: all };
        cached.current = result;
        setLoaded(result);
      } })
      .catch(() => { if (!controller.signal.aborted) { setLoaded(null); setError(true); } });
    return () => controller.abort();
  // Off/on and switching filters reuse the scoped revision for at most one minute.
  // Events, retries and access revalidation invalidate it; camera never does.
  }, [countryId, cityId, key, enabled]);
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => { if (document.visibilityState === "visible") { setLoaded(null); setRetry(n => n + 1); setNow(Date.now()); } };
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
  const active=enabled&&tasks!==null&&!error;
  useLayoutEffect(() => {
    onChange({scope,label,ids:matching.map(task=>task.id),active});
  },[scope,label,matching,active,onChange]);
  return <>
    <nav className="map-attention" aria-label="Фильтры построек">
      {MAP_ATTENTION_FILTERS.map(([value,label])=><button key={value} aria-pressed={modes.includes(value)} onClick={()=>{setNow(Date.now());setModes(current=>current.includes(value)?current.filter(mode=>mode!==value):[...current,value]);}}>{label}</button>)}
      {enabled&&<button onClick={()=>setModes([])}>Сбросить фильтр</button>}
      {enabled&&<span role="status">{error?<>Не удалось загрузить фильтр. <button onClick={()=>setRetry(value=>value+1)}>Повторить загрузку</button></>:tasks?`Найдено: ${matching.length}`:'Загрузка…'}</span>}
      {active&&<p className="map-attention-hint">{matching.length?'Остальные здания приглушены.':'Подходящих задач нет. Измените условия или сбросьте фильтр.'}</p>}
      {onSelectTask&&<button type="button" aria-haspopup="dialog" onClick={()=>setCatalogOpen(true)}>Список задач города</button>}
      <details className="task-sprint-legend">
        <summary>Значки работ</summary>
        <ul aria-label="Значки задач активного спринта">{SPRINT_BADGES.map(badge=><li key={badge.kind}>
          <svg aria-hidden="true" focusable="false" width="22" height="22" viewBox={`0 0 ${badge.width} ${badge.height}`} shapeRendering="crispEdges">
            {badge.paths.map(path=><path key={path.color} d={path.d} fill={`#${path.color.toString(16).padStart(6,'0')}`} />)}
          </svg><small>{badge.label}</small>
        </li>)}</ul>
      </details>
    </nav>
    {catalogOpen&&onSelectTask&&<TaskCatalogDialog countryId={countryId} cityId={cityId} userId={userId} revision={revision} onClose={()=>setCatalogOpen(false)} onSelectTask={onSelectTask} />}
  </>;
}
