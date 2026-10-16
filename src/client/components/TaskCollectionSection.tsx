import { useEffect, useId, useState, type ReactNode } from 'react';
import type { TaskCollection, TaskCollectionItems, TaskCollectionPageDto } from '../../shared/task-read-contracts';
import { ApiError } from '../api';
import { loadTaskCollection } from '../task-read-cache';
import { readTaskWithInvalidationRetry } from '../owned-read-cache';
import './task-pagination.css';

export function useTaskCollectionPage<C extends TaskCollection>({ countryId, taskId, collection, total, revision, seed, onAuthenticationRequired }: {
  countryId: string; taskId: string; collection: C; total: number; revision: number;
  seed?: TaskCollectionPageDto<C>; onAuthenticationRequired?: () => void;
}) {
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors.at(-1)!;
  const [page, setPage] = useState<TaskCollectionPageDto<C> | null>(seed ?? null);
  const [busy, setBusy] = useState(total > 0 && !seed);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    if (!total) { setPage(null); setBusy(false); return; }
    setBusy(true);
    const read = cursor === null && seed ? Promise.resolve(seed)
      : readTaskWithInvalidationRetry(controller.signal, () => loadTaskCollection(countryId, taskId, collection, cursor, controller.signal));
    void read.then(value => { if (!controller.signal.aborted) setPage(value); }).catch(reason => {
      if (controller.signal.aborted) return;
      if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) setPage(null);
      if (reason instanceof ApiError && [401, 403].includes(reason.status)) void Promise.resolve(onAuthenticationRequired?.()).catch(() => undefined);
      setError(reason instanceof Error ? reason.message : 'Не удалось загрузить страницу');
    }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [countryId, taskId, collection, cursor, total, revision, seed, retry, onAuthenticationRequired]);
  return {
    page, busy, error, pageNumber: cursors.length, hasPrevious: cursors.length > 1,
    next() { if (!busy && page?.nextCursor) { const next = page.nextCursor; setBusy(true); setPage(null); setCursors(current => current.at(-1) === next ? current : [...current, next]); } },
    previous() { if (!busy && cursors.length > 1) { setBusy(true); setPage(null); setCursors(current => current.slice(0, -1)); } },
    retry() { setRetry(current => current + 1); },
  };
}

export function TaskCollectionSection<C extends TaskCollection>({ label, empty, className, children, ...options }: {
  countryId: string; taskId: string; collection: C; total: number; revision: number;
  seed?: TaskCollectionPageDto<C>; onAuthenticationRequired?: () => void;
  label: string; empty: string; className?: string; children: (items: TaskCollectionItems[C][]) => ReactNode;
}) {
  const state = useTaskCollectionPage(options), id = useId();
  return <section className={className} aria-labelledby={id} aria-busy={state.busy}>
    <h3 id={id}>{label} <span>{options.total || ''}</span></h3>
    {state.error && <p role="alert" className="task-refresh-error">{state.error} <button type="button" onClick={state.retry}>Повторить</button></p>}
    {state.page?.items.length ? children(state.page.items) : !state.busy && !state.error ? <p className="muted">{empty}</p> : null}
    {state.busy && <p role="status" className="muted">Загружаем страницу…</p>}
    {(state.hasPrevious || state.page?.nextCursor) && <nav className="task-page-navigation" aria-label={`Страницы: ${label}`}>
      <button type="button" disabled={state.busy || !state.hasPrevious} onClick={state.previous} aria-label={`Предыдущая страница: ${label}`}>← Назад</button>
      <span>Страница {state.pageNumber}</span>
      <button type="button" disabled={state.busy || !state.page?.nextCursor} onClick={state.next} aria-label={`Следующая страница: ${label}`}>Далее →</button>
    </nav>}
  </section>;
}
