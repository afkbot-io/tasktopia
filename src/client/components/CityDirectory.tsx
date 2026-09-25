import { useEffect, useRef, useState } from "react";
import type { ArchiveRecordDto, BootstrapDto, PlanCityDto, PlanCityPageDto, PlanDistrictDto, PlanTaskDto } from "../../shared/contracts";
import { api } from "../api";
import { districtDevelopmentSummary } from "../district-development";

const districtStatus: Record<PlanDistrictDto["status"], string> = {
  PLANNED: "Запланирован", ACTIVE: "Активный", COMPLETED: "Завершён", ABANDONED: "Заброшен",
};

const taskStatus: Record<PlanTaskDto["status"], string> = {
  PLANNING: "В плане", STARTED: "В работе", IN_PROGRESS: "В работе", TESTING: "Приёмка", COMPLETED: "Завершено",
};
const taskType: Record<PlanTaskDto["workItemType"], string> = { TASK: "Строительство", BUG: "Ремонт", RELEASE: "Открытие", HOTFIX: "Срочный ремонт" };
const kindLabel: Record<ArchiveRecordDto["kind"], string> = {
  PROJECT: "Проект", REPOSITORY: "Репозиторий", ARCHITECTURE: "Архитектура",
  CONVENTION: "Правило", ENVIRONMENT: "Окружение", TEMPLATE: "Шаблон",
};

export function CityDirectory({ bootstrap, refreshToken, initialSection, initialFocus, onClose, onCityFocus, onTaskSelect, onArchiveRecordSelect }: {
  bootstrap: BootstrapDto;
  refreshToken: number;
  initialSection: "cities" | "archive";
  initialFocus?: { cityId: string; districtId: string };
  onClose: () => void;
  onCityFocus: (city: PlanCityDto) => void;
  onTaskSelect: (taskId: string) => void;
  onArchiveRecordSelect: (recordId: string) => void;
}) {
  const [cityId, setCityId] = useState(initialFocus?.cityId ?? bootstrap.initialCity?.id ?? "");
  const [districtId, setDistrictId] = useState(initialFocus?.districtId ?? "");
  const [cityQuery, setCityQuery] = useState("");
  const [cities, setCities] = useState<PlanCityDto[]>([]);
  const [districts, setDistricts] = useState<PlanDistrictDto[]>([]);
  const [tasks, setTasks] = useState<PlanTaskDto[]>([]);
  const [archiveSelected, setArchiveSelected] = useState(initialSection === "archive");
  const [archiveRecords, setArchiveRecords] = useState<ArchiveRecordDto[]>([]);
  const [citiesLoading, setCitiesLoading] = useState(true);
  const [districtsLoading, setDistrictsLoading] = useState(false);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => setArchiveSelected(initialSection === "archive"), [initialSection]);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (!drawerRef.current?.contains(event.target)) onClose();
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
    if (archiveSelected) { setCitiesLoading(false); return; }
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
        if (!controller.signal.aborted) setCities([...result]);
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
  }, [archiveSelected, bootstrap.country.id, refreshToken, reload]);

  useEffect(() => {
    if (!cityId || archiveSelected || !initialFocus) { setDistricts([]); setDistrictsLoading(false); return; }
    const controller = new AbortController();
    setDistricts([]);
    setDistrictsLoading(true);
    setError("");
    void api<PlanDistrictDto[]>(`/api/plan/cities/${cityId}/districts`, { signal: controller.signal })
      .then(setDistricts)
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "Не удалось загрузить районы");
      }).finally(() => { if (!controller.signal.aborted) setDistrictsLoading(false); });
    return () => controller.abort();
  }, [archiveSelected, cityId, initialFocus, refreshToken, reload]);

  useEffect(() => {
    if (!archiveSelected) return;
    const controller = new AbortController();
    setArchiveLoading(true);
    void api<ArchiveRecordDto[]>("/api/archive/records", { signal: controller.signal })
      .then(setArchiveRecords)
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "Не удалось загрузить Государственный архив");
      }).finally(() => { if (!controller.signal.aborted) setArchiveLoading(false); });
    return () => controller.abort();
  }, [archiveSelected, bootstrap.country.id, refreshToken, reload]);

  useEffect(() => {
    if (!districtId || archiveSelected) { setTasks([]); setTasksLoading(false); return; }
    const controller = new AbortController();
    setTasks([]);
    setTasksLoading(true);
    setError("");
    void api<PlanTaskDto[]>(`/api/plan/districts/${districtId}/tasks`, { signal: controller.signal })
      .then(setTasks)
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "Не удалось загрузить задачи");
      }).finally(() => { if (!controller.signal.aborted) setTasksLoading(false); });
    return () => controller.abort();
  }, [archiveSelected, districtId, refreshToken, reload]);

  const chooseCity = (nextCityId: string) => {
    setArchiveSelected(false);
    setCityId(nextCityId);
    setDistrictId("");
    const city = cities.find((candidate) => candidate.id === nextCityId);
    if (city) onCityFocus(city);
  };
  const visibleCities = cities.filter(city=>city.name.toLocaleLowerCase().includes(cityQuery.trim().toLocaleLowerCase()));
  const selectedDistrict = districts.find(district => district.id === districtId);
  const districtSummary = districtDevelopmentSummary(selectedDistrict?.name ?? "", tasks);

  return <aside ref={drawerRef} className="city-directory" aria-label={archiveSelected ? "Архив проекта" : initialFocus ? "Районы города" : "Города"}>
    <header className="plan-head"><div><p className="eyebrow">{bootstrap.country.name}</p><strong>{archiveSelected ? "Архив проекта" : initialFocus ? cities.find(city=>city.id===cityId)?.name ?? "Районы города" : "Города"}</strong></div><button onClick={onClose} aria-label="Закрыть список">×</button></header>
    {error && <div className="plan-error" role="alert">{error} <button onClick={() => setReload((value) => value + 1)}>Повторить</button></div>}
    <div className="directory-content">
      {!archiveSelected && !initialFocus && <section>
        <h3 className="plan-subheading">Города <span>{bootstrap.stats.cities}</span></h3>
        <input className="directory-search" aria-label="Найти город" placeholder="Найти город…" value={cityQuery} onChange={event=>setCityQuery(event.target.value)} />
        {citiesLoading && !error && <p className="plan-placeholder">Загружаем города…</p>}
        {!citiesLoading && cities.length === 0 && !error && <p className="plan-placeholder">Нет городов</p>}
        {!citiesLoading && cities.length>0 && visibleCities.length===0 && <p className="plan-placeholder">Подходящих городов нет</p>}
        {visibleCities.map((city) => <div key={city.id} className="plan-row"><button className={city.id === cityId ? "selected" : ""} onClick={() => chooseCity(city.id)}>
          <i>▦</i><span><strong>{city.name}</strong>{city.description && <small>{city.description.slice(0, 64)}</small>}{city.taskCount > 0 && <small>{city.taskCount} зданий</small>}</span>
        </button></div>)}
      </section>}
      {archiveSelected ? <section className="plan-tasks plan-archive-records"><h3>Записи архива <span>{archiveRecords.length}</span></h3>
        <p className="plan-section-note">Короткий устойчивый контекст проекта. Текущая работа остаётся в задачах.</p>
        {archiveLoading && !error && <p className="plan-placeholder">Загружаем архив…</p>}
        {!archiveLoading && archiveRecords.length === 0 && !error && <p className="plan-placeholder">Архив пока пуст</p>}
        {archiveRecords.map((record) => <div key={record.id} className="plan-row"><button onClick={() => onArchiveRecordSelect(record.id)}>
          <i className={`reference-kind-dot kind-${record.kind.toLowerCase()}`} /><span><strong>{record.title}</strong><small>{kindLabel[record.kind]}{record.body ? ` · ${record.body.slice(0, 72)}` : ""}</small></span>
        </button></div>)}
      </section> : initialFocus ? <>
      {!districtId && <section><h3>Районы <span>{districts.length}</span></h3>
        {!cityId && <p className="plan-placeholder">Выберите город</p>}
        {districtsLoading && !error && <p className="plan-placeholder">Загружаем районы…</p>}
        {cityId && !districtsLoading && districts.length === 0 && !error && <p className="plan-placeholder">В городе пока нет районов</p>}
        {districts.map((district) => <div key={district.id} className="plan-row"><button className={district.id === districtId ? "selected" : ""} onClick={() => setDistrictId(district.id)}>
          <i className={`district-dot district-${district.status.toLowerCase()}`} /><span><strong>{district.name}</strong><small>{districtStatus[district.status]} · {district.taskCount} задач{district.deadline ? ` · до ${new Date(district.deadline).toLocaleDateString("ru-RU")}` : ""}</small></span>
        </button></div>)}
      </section>}
      {districtId && <section className="plan-tasks"><button className="directory-back" onClick={()=>setDistrictId("")}>← Все районы</button><p className="directory-district-name">{districtSummary.title}</p>
        {!tasksLoading && !error && tasks.length > 0 && <div className="directory-district-summary" role="group" aria-label="Сводка района"><p>{districtSummary.line}</p><p>{districtSummary.detail}</p></div>}
        <h3>Задачи <span>{tasks.length}</span></h3>
        {!districtId && <p className="plan-placeholder">Выберите район</p>}
        {tasksLoading && !error && <p className="plan-placeholder">Загружаем задачи…</p>}
        {!tasksLoading && tasks.length === 0 && !error && <p className="plan-placeholder">В районе пока нет задач</p>}
        {tasks.map((task) => <div key={task.id} className="plan-row"><button onClick={() => onTaskSelect(task.id)}>
          <i className={`task-stage-dot stage-${task.stage}`}>{task.stage}</i><span><strong>#{task.taskNumber} · {task.title}</strong><small>{taskType[task.workItemType]} · {taskStatus[task.status]} · {task.progress}% · <span title="Объём работ в условных единицах сложности (SP)">Объём: {task.estimate} SP</span>{task.activeDefectCount > 0 ? ` · ${task.activeDefectCount} деф.` : ""}</small></span>
        </button></div>)}
      </section>}
      </> : null}
    </div>
  </aside>;
}
