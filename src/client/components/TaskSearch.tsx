import { useEffect, useId, useRef, useState } from "react";
import type { TaskSearchResultDto } from "../../shared/contracts";
import { api } from "../api";
import { GameIcon } from "./ui";

const statusLabel: Record<TaskSearchResultDto["status"], string> = {
  PLANNING: "В плане", STARTED: "В работе", IN_PROGRESS: "В работе", TESTING: "Приёмка", COMPLETED: "Готово",
};

/** Header search: by task number (#42 or 42) or by title substring. */
export function TaskSearch({ onSelect }: { onSelect: (result: TaskSearchResultDto) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TaskSearchResultDto[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [active, setActive] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef(0);
  const listId = useId();

  useEffect(() => {
    const requestId = ++requestRef.current;
    const controller = new AbortController();
    const text = query.trim().replace(/^#/, "");
    if (!text) return;
    const timer = setTimeout(() => {
      void api<TaskSearchResultDto[]>(`/api/tasks/search?q=${encodeURIComponent(text)}&limit=10`, { signal: controller.signal })
        .then((found) => {
          if (controller.signal.aborted || requestRef.current !== requestId) return;
          setResults(found);
        })
        .catch(() => { if (!controller.signal.aborted && requestRef.current === requestId) setError(true); })
        .finally(() => { if (!controller.signal.aborted && requestRef.current === requestId) setLoading(false); });
    }, 220);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, retry]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);
  useEffect(() => {
    if (open && active >= 0) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, open, listId]);

  const begin = (value: string) => {
    // Invalidate before effect cleanup: no stale result can be selected while typing.
    requestRef.current++;
    setResults([]); setActive(-1); setError(false);
    const hasText = Boolean(value.trim().replace(/^#/, ""));
    setLoading(hasText); setOpen(hasText);
  };
  const select = (result: TaskSearchResultDto) => {
    begin(""); setQuery(""); onSelect(result);
  };

  return (
    <div ref={rootRef} className="task-search" role="search">
      <span className="task-search-icon"><GameIcon name="search" /></span>
      <input
        value={query}
        onChange={event => { begin(event.target.value); setQuery(event.target.value); }}
        onFocus={() => { if (query.trim()) setOpen(true); }}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.stopPropagation(); setOpen(false); setActive(-1); }
          if ((event.key === "ArrowDown" || event.key === "ArrowUp") && results.length && !loading && !error) {
            event.preventDefault(); setOpen(true);
            setActive(current => event.key === "ArrowDown" ? (current + 1) % results.length : (current < 0 ? results.length - 1 : (current - 1 + results.length) % results.length));
          }
          if (event.key === "Enter" && open && !loading && !error && results.length) {
            event.preventDefault(); select(results[active >= 0 ? active : 0]!);
          }
        }}
        placeholder="Поиск: № или название"
        aria-label="Поиск здания по номеру или названию"
        role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off" spellCheck={false}
      />
      {open && <div className="task-search-results" tabIndex={0} role="region" aria-label="Результаты поиска" onKeyDown={event => {
        if (event.key === "Escape") { event.stopPropagation(); setOpen(false); rootRef.current?.querySelector("input")?.focus(); }
      }}>
        {loading && <p className="task-search-empty" role="status">Ищем задачи…</p>}
        {error && <div className="task-search-empty" role="alert"><p>Не удалось выполнить поиск.</p><button type="button" onClick={() => { begin(query); setRetry(n => n + 1); }}>Повторить поиск</button></div>}
        {!loading && !error && results.length === 0 && <p className="task-search-empty" role="status">Ничего не найдено</p>}
        <ul id={listId} role="listbox" aria-label="Найденные задачи" aria-busy={loading}>
        {results.map((result, index) => (
          <li key={result.id} role="presentation">
            <button
              type="button" id={`${listId}-${index}`} tabIndex={-1}
              role="option"
              aria-selected={active === index}
              onClick={() => select(result)}
            >
              <strong>#{result.taskNumber}</strong>
              <span className="task-search-title">{result.title}</span>
              <small>{result.cityName} · {result.districtName} · {statusLabel[result.status]}</small>
            </button>
          </li>
        ))}
        </ul>
      </div>}
    </div>
  );
}
