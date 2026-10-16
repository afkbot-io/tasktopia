import { useCallback, useEffect, useRef, useState } from 'react';
import type { CityNews, CityNewsItem, CityNewsKind } from '../shared/city-news';
import { ApiError } from './api';
import { markNewsRead, readNewsPage } from './news-feed-reader';
import { applyNewsRead } from './news-feed-state';

type Navigation = { scope: string; cursors: (string | null)[]; index: number };
type PageState = { key: string; data?: CityNews; error?: string; pending: boolean };
type Selection = Pick<CityNewsItem, 'taskId' | 'kind' | 'lastEventId'>;
const start = (scope: string): Navigation => ({ scope, cursors: [null], index: 0 });

/** Reading and navigation never acknowledge news. Only an explicit action does. */
export function useNewsFeed({ userId, countryId, open, history, kind, revision = 0, onAuthenticationRequired }: {
  userId: string; countryId: string; open: boolean; history: boolean; kind?: CityNewsKind;
  revision?: number; onAuthenticationRequired?: () => Promise<void>;
}) {
  const accountScope = JSON.stringify([userId, countryId]);
  const scope = JSON.stringify([accountScope, history, kind ?? null]);
  const [navigation, setNavigation] = useState<Navigation>(() => start(scope));
  const current = navigation.scope === scope ? navigation : start(scope);
  const cursor = current.cursors[current.index] ?? null;
  const key = JSON.stringify([scope, cursor]);
  const [page, setPage] = useState<PageState>();
  const [badge, setBadge] = useState<{ scope: string; count: number }>();
  const [refresh, setRefresh] = useState(0);
  const [actionState, setActionState] = useState<{ scope: string; pending: boolean; failed?: Selection[]; saved?: boolean }>();
  const action = useRef<{ scope: string; controller: AbortController } | null>(null);
  const readGeneration = useRef(0);
  const auth = useRef(onAuthenticationRequired);
  useEffect(() => { auth.current = onAuthenticationRequired; }, [onAuthenticationRequired]);
  const checkAuthentication = useCallback((cause: unknown) => {
    if (cause instanceof ApiError && cause.status === 401) void auth.current?.().catch(() => undefined);
  }, []);
  useEffect(() => { setNavigation(previous => previous.scope === scope ? previous : start(scope)); }, [scope]);
  useEffect(() => () => { action.current?.controller.abort(); action.current = null; }, [accountScope]);
  useEffect(() => {
    const update = () => { if (!document.hidden) setRefresh(value => value + 1); };
    const timer = setInterval(update, 60_000);
    window.addEventListener('online', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearInterval(timer); window.removeEventListener('online', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const generation = readGeneration.current;
    setPage(previous => ({ key, data: previous?.key === key ? previous.data : undefined, pending: true }));
    const timer = setTimeout(() => {
      void readNewsPage({ countryId, history, kind, cursor }, controller.signal).then(data => {
        if (controller.signal.aborted || generation !== readGeneration.current) return;
        setPage({ key, data, pending: false });
        if (!kind) setBadge({ scope: accountScope, count: data.unreadCount });
      }).catch(cause => {
        if (controller.signal.aborted || generation !== readGeneration.current) return;
        setPage({ key, pending: false, error: 'Не удалось получить новости.' });
        if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) { readGeneration.current++; setBadge(undefined); }
        checkAuthentication(cause);
      });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [accountScope, countryId, history, kind, cursor, key, open, revision, refresh, checkAuthentication]);
  useEffect(() => {
    // An unfiltered open page already carries the authoritative global count.
    if (open && !kind) return;
    const controller = new AbortController();
    const generation = readGeneration.current;
    const timer = setTimeout(() => {
      void readNewsPage({ countryId, history: false, limit: 1 }, controller.signal).then(data => {
        if (!controller.signal.aborted && generation === readGeneration.current) setBadge({ scope: accountScope, count: data.unreadCount });
      }).catch(cause => {
        if (controller.signal.aborted || generation !== readGeneration.current) return;
        if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
          readGeneration.current++; setBadge(undefined);
          setPage({ key, pending: false, error: 'Новости недоступны. Проверьте доступ и повторите загрузку.' });
        }
        checkAuthentication(cause);
      });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [accountScope, countryId, key, open, kind, revision, refresh, checkAuthentication]);
  const acknowledge = async (selection: readonly Selection[]) => {
    if (!selection.length || action.current) return false;
    const snapshot = selection.map(({ taskId, kind, lastEventId }) => ({ taskId, kind, lastEventId }));
    const request = { scope: accountScope, controller: new AbortController() };
    action.current = request;
    setActionState({ scope: accountScope, pending: true });
    try {
      await markNewsRead(countryId, snapshot.map(item => item.lastEventId), request.controller.signal);
      if (request.controller.signal.aborted || action.current !== request) return false;
      readGeneration.current++;
      setPage(previous => previous?.key === key && previous.data
        ? { ...previous, data: applyNewsRead(previous.data, snapshot) } : previous);
      setActionState({ scope: accountScope, pending: false, saved: true });
      setRefresh(value => value + 1);
      return true;
    } catch (cause) {
      if (request.controller.signal.aborted || action.current !== request) return false;
      setActionState({ scope: accountScope, pending: false, failed: snapshot });
      if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
        readGeneration.current++;
        setPage({ key, pending: false, error: 'Новости недоступны. Проверьте доступ и повторите загрузку.' });
        setBadge(undefined);
      }
      checkAuthentication(cause);
      return false;
    } finally { if (action.current === request) action.current = null; }
  };
  const visible = page?.key === key ? page : undefined;
  const activeAction = actionState?.scope === accountScope ? actionState : undefined;
  return {
    data: visible?.data, pending: open && (!visible || visible.pending), error: visible?.error,
    unreadCount: badge?.scope === accountScope ? badge.count : 0,
    busy: activeAction?.pending ?? false, readError: Boolean(activeAction?.failed), saved: activeAction?.saved ?? false,
    acknowledge, retryRead: () => { if (activeAction?.failed) void acknowledge(activeAction.failed); },
    retry: () => setRefresh(value => value + 1), pageNumber: current.index + 1,
    hasPrevious: current.index > 0, hasNext: Boolean(visible?.data?.nextCursor),
    latest: () => setNavigation(start(scope)),
    previous: () => setNavigation(previous => {
      const value = previous.scope === scope ? previous : start(scope);
      return value.index > 0 ? { ...value, index: value.index - 1 } : value;
    }),
    next: () => {
      const next = visible?.data?.nextCursor; if (!next || visible.pending) return;
      setNavigation(previous => {
        const value = previous.scope === scope ? previous : start(scope);
        return { scope, cursors: [...value.cursors.slice(0, value.index + 1), next], index: value.index + 1 };
      });
    },
  };
}
