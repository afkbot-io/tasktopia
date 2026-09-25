import { useToolbarDisclosure } from "../use-toolbar-disclosure";
import { useEffect, useRef, useState } from "react";
import type { CityNews } from "../../shared/city-news";
import { api } from "../api";
const labels = {
  COMPLETED: "Строительство завершено",
  DEFECT: "Нужен ремонт",
  OPENED: "Открыта городская служба",
  ASSIGNED: "Вы назначены исполнителем",
};
export function WorldDigest({
  countryId,
  onTask,
}: {
  userId: string;
  countryId: string;
  onTask: (id: string) => void;
}) {
  const root = useToolbarDisclosure();
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState(false);
  const [before, setBefore] = useState<number | null>(null);
  const [data, setData] = useState<CityNews>();
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [readError, setReadError] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const c = new AbortController();
    setError(false);
    const q = new URLSearchParams({ countryId, history: String(history) });
    if (before) q.set("before", String(before));
    void api<CityNews>(`/api/city-news?${q}`, { signal: c.signal })
      .then((d) => {
        if (!c.signal.aborted) setData(d);
      })
      .catch(() => {
        if (!c.signal.aborted) {
          setError(true);
          setData(undefined);
        }
      });
    return () => c.abort();
  }, [countryId, history, before, refresh]);
  useEffect(() => {
    const update = () => {
      if (!document.hidden) setRefresh((n) => n + 1);
    };
    const timer = setInterval(update, 60000);
    window.addEventListener("online", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [open]);
  useEffect(() => {
    if (!open || !data || !list.current) return;
    const pending = new Set<number>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let alive = true;
    const observer = new IntersectionObserver(
      (entries) => {
        if (document.hidden) return;
        for (const entry of entries)
          if (entry.isIntersecting && entry.intersectionRatio >= 0.8) {
            const id = Number((entry.target as HTMLElement).dataset.event);
            pending.add(id);
            observer.unobserve(entry.target);
          }
        if (pending.size && !timer)
          timer = setTimeout(() => {
            if (document.hidden || !root.current?.open) {
              timer = undefined;
              return;
            }
            const ids = [...pending];
            pending.clear();
            timer = undefined;
            void api("/api/city-news/read", {
              method: "POST",
              json: { countryId, eventIds: ids },
            })
              .then(() => {
                if (alive) {
                  setReadError(false);
                  setData((current) =>
                    current
                      ? {
                          ...current,
                          unreadCount: Math.max(
                            0,
                            current.unreadCount -
                              current.items.filter(
                                (i) => i.unread && ids.includes(i.lastEventId),
                              ).length,
                          ),
                          items: current.items.map((i) =>
                            ids.includes(i.lastEventId)
                              ? { ...i, unread: false }
                              : i,
                          ),
                        }
                      : current,
                  );
                }
              })
              .catch(() => {
                if (alive) setReadError(true);
              });
          }, 400);
      },
      { threshold: 0.8 },
    );
    list.current
      .querySelectorAll("[data-event]")
      .forEach((n) => observer.observe(n));
    return () => {
      alive = false;
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [open, data, countryId, root]);
  return (
    <details
      ref={root}
      className="world-digest game-popover"
      open={open}
      onToggle={(e) => {
        setOpen(e.currentTarget.open);
        if (e.currentTarget.open) {
          setBefore(null);
          setRefresh((n) => n + 1);
        }
      }}
    >
      <summary aria-label="Уведомления" title="Уведомления">
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 18 18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M7 3V2h4v1M4 12V7a5 5 0 0 1 10 0v5l1 2H3l1-2ZM7 16h4" />
        </svg>
        {!!data?.unreadCount && (
          <span className="notification-count">
            {data.unreadCount > 99 ? "99+" : data.unreadCount}
          </span>
        )}
      </summary>
      {open && (
        <section className="game-popover-panel" aria-label="Уведомления">
          <div className="world-digest-heading">
            <strong>Новости мира</strong>
            <button aria-label="Закрыть сводку" onClick={() => setOpen(false)}>
              ×
            </button>
          </div>
          <nav className="document-tabs" aria-label="Лента уведомлений">
            <button
              aria-pressed={!history}
              onClick={() => {
                setHistory(false);
                setBefore(null);
                setData(undefined);
                setRefresh((n) => n + 1);
              }}
            >
              Новые
            </button>
            <button
              aria-pressed={history}
              onClick={() => {
                setHistory(true);
                setBefore(null);
                setData(undefined);
                setRefresh((n) => n + 1);
              }}
            >
              История
            </button>
          </nav>
          <small>За последние 30 дней</small>
          {error ? (
            <p role="alert">
              Не удалось получить новости.{" "}
              <button onClick={() => setRefresh((n) => n + 1)}>
                Повторить
              </button>
            </p>
          ) : !data ? (
            <p role="status">Получаем новости…</p>
          ) : (
            <>
              <ul ref={list}>
                {data.items.map((i) => (
                  <li
                    key={`${i.taskId}:${i.kind}`}
                    data-event={i.unread ? i.lastEventId : undefined}
                  >
                    <button
                      onClick={() => {
                        setOpen(false);
                        onTask(i.taskId);
                      }}
                    >
                      <strong>
                        №{i.taskNumber} · {i.title}
                      </strong>
                      <span>
                        {labels[i.kind]}
                        {i.count > 1 ? ` · ${i.count}` : ""} · {i.cityName}
                      </span>
                      <time>{new Date(i.at).toLocaleString("ru-RU")}</time>
                    </button>
                  </li>
                ))}
              </ul>
              {!data.items.length && (
                <p>
                  {history
                    ? "В истории пока нет событий."
                    : "Новых событий пока нет."}
                </p>
              )}
              {data.nextBefore && (
                <button
                  onClick={() => {
                    setBefore(data.nextBefore);
                    setData(undefined);
                  }}
                >
                  Более ранние
                </button>
              )}
              {before && (
                <button
                  onClick={() => {
                    setBefore(null);
                    setRefresh((n) => n + 1);
                  }}
                >
                  К последним
                </button>
              )}
            </>
          )}
          {readError && (
            <p role="alert">
              Не удалось сохранить прочтение.{" "}
              <button onClick={() => setRefresh((n) => n + 1)}>
                Повторить
              </button>
            </p>
          )}
        </section>
      )}
    </details>
  );
}
