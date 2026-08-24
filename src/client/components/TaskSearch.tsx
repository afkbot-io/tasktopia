import { useEffect, useRef, useState } from "react";
import type { TaskSearchResultDto } from "../../shared/contracts";
import { api } from "../api";

const statusLabel: Record<TaskSearchResultDto["status"], string> = {
  PLANNING: "План", STARTED: "Старт", IN_PROGRESS: "В работе", TESTING: "Тест", COMPLETED: "Готово",
};

/** Header search: by task number (#42 or 42) or by title substring. */
export function TaskSearch({ onSelect }: { onSelect: (result: TaskSearchResultDto) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TaskSearchResultDto[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    const text = query.trim().replace(/^#/, "");
    if (text.length < 1) {
      setResults([]);
      setOpen(false);
      return;
    }
    const requestId = ++requestRef.current;
    const timer = setTimeout(() => {
      setLoading(true);
      void api<TaskSearchResultDto[]>(`/api/tasks/search?q=${encodeURIComponent(text)}&limit=10`)
        .then((found) => {
          if (requestRef.current !== requestId) return;
          setResults(found);
          setOpen(true);
        })
        .catch(() => { if (requestRef.current === requestId) setResults([]); })
        .finally(() => { if (requestRef.current === requestId) setLoading(false); });
    }, 220);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, []);

  return (
    <div ref={rootRef} className="task-search" role="search">
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => { if (results.length > 0) setOpen(true); }}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
          if (event.key === "Enter" && results.length > 0) {
            onSelect(results[0]!);
            setOpen(false);
            setQuery("");
          }
        }}
        placeholder="Поиск здания: № или название"
        aria-label="Поиск здания по номеру или названию"
      />
      {open && <ul className="task-search-results" role="listbox">
        {results.length === 0 && !loading && <li className="task-search-empty">Ничего не найдено</li>}
        {results.map((result) => (
          <li key={result.id}>
            <button
              role="option"
              aria-selected="false"
              onClick={() => {
                onSelect(result);
                setOpen(false);
                setQuery("");
              }}
            >
              <strong>#{result.taskNumber}</strong>
              <span className="task-search-title">{result.title}</span>
              <small>{result.cityName} · {result.districtName} · {statusLabel[result.status]}</small>
            </button>
          </li>
        ))}
      </ul>}
    </div>
  );
}
