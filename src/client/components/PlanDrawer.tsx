import { useEffect, useRef, useState } from "react";
import type { BootstrapDto, PlanCityDto, PlanCityPageDto, PlanDistrictDto, PlanTaskDto } from "../../shared/contracts";
import { api } from "../api";

const districtStatus: Record<PlanDistrictDto["status"], string> = {
  PLANNED: "Запланирован", ACTIVE: "Строится", COMPLETED: "Завершён",
};

const taskStatus: Record<PlanTaskDto["status"], string> = {
  PLANNING: "Планирование", STARTED: "В работе · 0%", IN_PROGRESS: "В работе", TESTING: "Тестирование", COMPLETED: "Завершено",
};

export function PlanDrawer({ bootstrap, refreshToken, onClose, onCityFocus, onTaskSelect }: {
  bootstrap: BootstrapDto;
  refreshToken: number;
  onClose: () => void;
  onCityFocus: (city: PlanCityDto) => void;
  onTaskSelect: (taskId: string) => void;
}) {
  const [cityId, setCityId] = useState(bootstrap.initialCity?.id ?? "");
  const [districtId, setDistrictId] = useState("");
  const [cities, setCities] = useState<PlanCityDto[]>([]);
  const [districts, setDistricts] = useState<PlanDistrictDto[]>([]);
  const [tasks, setTasks] = useState<PlanTaskDto[]>([]);
  const [citiesLoading, setCitiesLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (!drawerRef.current?.contains(event.target) && !event.target.closest("[data-plan-trigger]")) onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setCitiesLoading(true);
    const loadCities = async () => {
      const result: PlanCityDto[] = [];
      let cursor: string | null = null;
      do {
        const query = new URLSearchParams({ limit: "50" });
        if (cursor) query.set("cursor", cursor);
        const page = await api<PlanCityPageDto>(`/api/plan/cities-page?${query}`, { signal: controller.signal });
        result.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor && !controller.signal.aborted);
      return result;
    };
    void loadCities()
      .then((next) => {
        setCities(next);
        setCityId((current) => current && next.some((city) => city.id === current) ? current : next[0]?.id ?? "");
      })
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "Не удалось загрузить города");
      })
      .finally(() => { if (!controller.signal.aborted) setCitiesLoading(false); });
    return () => controller.abort();
  }, [bootstrap.country.id, refreshToken, reload]);

  useEffect(() => {
    if (!cityId) { setDistricts([]); return; }
    const controller = new AbortController();
    setError("");
    void api<PlanDistrictDto[]>(`/api/plan/cities/${cityId}/districts`, { signal: controller.signal })
      .then(setDistricts)
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "Не удалось загрузить районы");
      });
    return () => controller.abort();
  }, [cityId, refreshToken, reload]);

  useEffect(() => {
    if (!districtId) { setTasks([]); return; }
    const controller = new AbortController();
    setError("");
    void api<PlanTaskDto[]>(`/api/plan/districts/${districtId}/tasks`, { signal: controller.signal })
      .then(setTasks)
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "Не удалось загрузить задачи");
      });
    return () => controller.abort();
  }, [districtId, refreshToken, reload]);

  const chooseCity = (nextCityId: string) => {
    setCityId(nextCityId);
    setDistrictId("");
    const city = cities.find((candidate) => candidate.id === nextCityId);
    if (city) onCityFocus(city);
  };

  return <aside ref={drawerRef} className="plan-drawer" aria-label="План страны">
    <header className="plan-head"><div><p className="eyebrow">ПЛАН СТРАНЫ</p><strong>{bootstrap.country.name}</strong></div><button onClick={onClose} aria-label="Закрыть план">×</button></header>
    {error && <div className="plan-error" role="alert">{error} <button onClick={() => setReload((value) => value + 1)}>Повторить</button></div>}
    <div className="plan-columns">
      <section><h3>Города <span>{bootstrap.stats.cities}</span></h3>
        {citiesLoading && !error && <p className="plan-placeholder">Загружаем города…</p>}
        {!citiesLoading && cities.length === 0 && !error && <p className="plan-placeholder">Нет городов</p>}
        {cities.map((city) => <button key={city.id} className={city.id === cityId ? "selected" : ""} onClick={() => chooseCity(city.id)}>
          <i>▦</i><span><strong>{city.name}</strong>{city.taskCount > 0 && <small>{city.taskCount} зданий</small>}</span>
        </button>)}
      </section>
      <section><h3>Районы <span>{districts.length}</span></h3>
        {!cityId && <p className="plan-placeholder">Выберите город</p>}
        {cityId && districts.length === 0 && !error && <p className="plan-placeholder">Загружаем районы…</p>}
        {districts.map((district) => <button key={district.id} className={district.id === districtId ? "selected" : ""} onClick={() => setDistrictId(district.id)}>
          <i className={`district-dot district-${district.status.toLowerCase()}`} /><span><strong>{district.name}</strong><small>{districtStatus[district.status]} · {district.taskCount} задач</small></span>
        </button>)}
      </section>
      <section className="plan-tasks"><h3>Задачи <span>{tasks.length}</span></h3>
        {!districtId && <p className="plan-placeholder">Выберите район</p>}
        {districtId && tasks.length === 0 && !error && <p className="plan-placeholder">В районе пока нет задач</p>}
        {tasks.map((task) => <button key={task.id} onClick={() => onTaskSelect(task.id)}>
          <i className={`task-stage-dot stage-${task.stage}`}>{task.stage}</i><span><strong>{task.title}</strong><small>{taskStatus[task.status]} · {task.progress}% · {task.estimate} SP</small></span>
        </button>)}
      </section>
    </div>
  </aside>;
}
