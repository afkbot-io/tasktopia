import { useEffect, useRef, useState } from "react";
import type {
  PlanCityPageDto,
  PlanCityDto,
  PlanDistrictDto,
} from "../../shared/contracts";
import {
  REPORT_GROUPS,
  reportGroup,
  taskAttention,
  type CityReport,
} from "../../shared/city-report";
import { api } from "../api";
import { useDialogFocus } from "../use-dialog-focus";
export function CityDocuments({
  countryId,
  initialCityId,
  revision,
  hidden,
  onClose,
  onTask,
}: {
  countryId: string;
  initialCityId?: string;
  revision: number;
  hidden: boolean;
  onClose: () => void;
  onTask: (id: string) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  useDialogFocus(ref);
  const districtScope = useRef("");
  const [tab, setTab] = useState<"plan" | "summary" | "attention">("plan");
  const [city, setCity] = useState(initialCityId ?? "");
  const [district, setDistrict] = useState("");
  const [cities, setCities] = useState<PlanCityDto[]>([]);
  const [districts, setDistricts] = useState<PlanDistrictDto[]>([]);
  const [scopeRetry, setScopeRetry] = useState(0);
  const [scopeReady, setScopeReady] = useState(false);
  const [scopeError, setScopeError] = useState(false);
  const [data, setData] = useState<CityReport>();
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [offset, setOffset] = useState(0);
  const [days, setDays] = useState(7);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !hidden) {
        e.stopImmediatePropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [hidden, onClose]);
  useEffect(() => {
    const c = new AbortController();
    setScopeError(false);
    void (async () => {
      const items: PlanCityDto[] = [];
      let cursor: string | null = null;
      do {
        const q = new URLSearchParams({ limit: "50" });
        if (cursor) q.set("cursor", cursor);
        const p = await api<PlanCityPageDto>(`/api/plan/cities-page?${q}`, {
          signal: c.signal,
        });
        items.push(...p.items);
        cursor = p.nextCursor;
      } while (cursor && !c.signal.aborted);
      if (!c.signal.aborted) setCities(items);
    })().catch(() => {
      if (!c.signal.aborted) setScopeError(true);
    });
    return () => c.abort();
  }, [countryId, scopeRetry, revision]);
  useEffect(() => {
    const c = new AbortController();
    const scope = `${countryId}:${city}`;
    const changed = districtScope.current !== scope;
    districtScope.current = scope;
    setScopeError(false);
    if (changed) {
      setScopeReady(false);
      setDistricts([]);
      setDistrict("");
      setOffset(0);
    }
    if (!city) {
      setScopeReady(true);
      return;
    }
    void api<PlanDistrictDto[]>(`/api/plan/cities/${city}/districts`, {
      signal: c.signal,
    })
      .then((d) => {
        if (c.signal.aborted) return;
        setDistricts(d);
        setDistrict((current) =>
          changed
            ? (d.find((x) => x.status === "ACTIVE")?.id ?? "")
            : d.some((x) => x.id === current)
              ? current
              : "",
        );
        setScopeReady(true);
      })
      .catch(() => {
        if (!c.signal.aborted) setScopeError(true);
      });
    return () => c.abort();
  }, [city, countryId, scopeRetry, revision]);
  useEffect(() => {
    if (!scopeReady) return;
    const c = new AbortController();
    setError(false);
    setData(undefined);
    const q = new URLSearchParams({
      countryId,
      offset: String(offset),
      days: String(days),
      attention: String(tab === "attention"),
    });
    if (city) q.set("cityId", city);
    if (district) q.set("districtId", district);
    void api<CityReport>(`/api/city-report?${q}`, { signal: c.signal })
      .then((d) => {
        if (!c.signal.aborted) setData(d);
      })
      .catch(() => {
        if (!c.signal.aborted) setError(true);
      });
    return () => c.abort();
  }, [
    countryId,
    city,
    district,
    tab,
    offset,
    days,
    scopeReady,
    revision,
    retry,
  ]);
  const selected = districts.find((d) => d.id === district);
  return (
    <div
      className="modal-backdrop documents-backdrop"
      style={hidden ? { display: "none" } : undefined}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="city-documents-title"
        className="city-documents game-document"
      >
        <header>
          <div>
            <small>ГОРОДСКАЯ КАНЦЕЛЯРИЯ</small>
            <h2 id="city-documents-title">Документы</h2>
          </div>
          <button onClick={onClose} aria-label="Закрыть документы">
            ×
          </button>
        </header>
        <nav className="document-tabs" aria-label="Вид документа">
          {(
            [
              ["plan", "План строительства"],
              ["summary", "Сводка"],
              ["attention", "Требует внимания"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              aria-pressed={tab === id}
              onClick={() => {
                setTab(id);
                setOffset(0);
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="document-filters">
          <label>
            Город
            <select
              aria-label="Город"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            >
              <option value="">Весь проект</option>
              {cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {city && (
            <label>
              Район
              <select
                aria-label="Район"
                value={district}
                disabled={!scopeReady}
                onChange={(e) => {
                  setDistrict(e.target.value);
                  setOffset(0);
                }}
              >
                <option value="">Весь город</option>
                {districts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {d.status === "ACTIVE" ? " · активный" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          {tab === "summary" && (
            <label>
              Период
              <select
                aria-label="Период"
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              >
                <option value={7}>7 дней</option>
                <option value={30}>30 дней</option>
              </select>
            </label>
          )}
        </div>
        <div className="document-body">
          {selected && (selected.goal || selected.deadline) && (
            <p className="document-goal">
              {selected.goal}
              {selected.deadline && (
                <small>
                  Срок:{" "}
                  {new Date(selected.deadline).toLocaleDateString("ru-RU")}
                </small>
              )}
            </p>
          )}
          {error || scopeError ? (
            <p role="alert">
              Не удалось открыть документ.{" "}
              <button
                onClick={() =>
                  scopeError
                    ? setScopeRetry((n) => n + 1)
                    : setRetry((n) => n + 1)
                }
              >
                Повторить
              </button>
            </p>
          ) : !scopeReady || !data ? (
            <p role="status">Получаем городской отчёт…</p>
          ) : tab === "summary" ? (
            <>
              <h3>Состояние строительства</h3>
              <dl className="document-counts">
                {[
                  [
                    "Готово / всего",
                    `${data.counts.completed} / ${data.counts.working + data.counts.planned + data.counts.completed}`,
                  ],
                  ["В работе", data.counts.working],
                  ["На приёмке", data.counts.testing],
                  ["Запланировано", data.counts.planned],
                  ["Требует внимания", data.counts.attention],
                  [`Завершено за ${days} дней`, data.counts.completedPeriod],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <p>
                Считаем задачи. Приёмка входит в работы, которые ещё не
                завершены.
              </p>
              <button
                onClick={() => {
                  setTab("attention");
                  setOffset(0);
                }}
              >
                Посмотреть, что требует внимания
              </button>
            </>
          ) : (
            <>
              <p className="document-total">
                {data.total
                  ? `Объекты ${offset + 1}–${offset + data.items.length} из ${data.total}`
                  : tab === "attention"
                    ? "Нет объектов, требующих внимания."
                    : "В этом разделе пока нет задач."}
              </p>
              {REPORT_GROUPS.map((label, index) => {
                const tasks = data.items.filter(
                  (t) => reportGroup(t.status) === index,
                );
                return (
                  tasks.length > 0 && (
                    <section key={label} aria-label={label}>
                      <h3>{label}</h3>
                      <ul className="document-tasks">
                        {tasks.map((t) => (
                          <li key={t.id}>
                            <button onClick={() => onTask(t.id)}>
                              <i aria-hidden="true">
                                {t.status === "COMPLETED"
                                  ? "✓"
                                  : t.status === "PLANNING"
                                    ? "□"
                                    : "▧"}
                              </i>
                              <span>
                                <strong>
                                  №{t.taskNumber} · {t.title}
                                </strong>
                                <small>
                                  {!city ? `${t.cityName} · ` : ""}
                                  {!district ? `${t.districtName} · ` : ""}
                                  {t.assignee ?? "Не назначен"}
                                </small>
                                {taskAttention(t).length > 0 && (
                                  <em>{taskAttention(t).join(" · ")}</em>
                                )}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )
                );
              })}
              {(offset > 0 || data.nextOffset !== null) && (
                <nav
                  className="document-pagination"
                  aria-label="Страницы документа"
                >
                  <button
                    disabled={offset === 0}
                    onClick={() => setOffset((n) => Math.max(0, n - 50))}
                  >
                    Назад
                  </button>
                  <button
                    disabled={data.nextOffset === null}
                    onClick={() => setOffset(data.nextOffset!)}
                  >
                    Далее
                  </button>
                </nav>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
