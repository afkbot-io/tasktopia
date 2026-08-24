import { useEffect, useRef, useState } from "react";
import type { ArchiveRecordDto, BootstrapDto, PlanCityDto, PlanCityPageDto, PlanDistrictDto, PlanTaskDto } from "../../shared/contracts";
import { api } from "../api";

const districtStatus: Record<PlanDistrictDto["status"], string> = {
  PLANNED: "Запланирован", ACTIVE: "Строится", COMPLETED: "Завершён", ABANDONED: "Заброшен",
};

const taskStatus: Record<PlanTaskDto["status"], string> = {
  PLANNING: "Планирование", STARTED: "В работе · 0%", IN_PROGRESS: "В работе", TESTING: "Тестирование", COMPLETED: "Завершено",
};
const taskType: Record<PlanTaskDto["workItemType"], string> = { TASK: "Задача", BUG: "Баг", RELEASE: "Релиз", HOTFIX: "Хотфикс" };
const kindLabel: Record<ArchiveRecordDto["kind"], string> = {
  PROJECT: "Проект", REPOSITORY: "Репозиторий", ARCHITECTURE: "Архитектура",
  CONVENTION: "Правило", ENVIRONMENT: "Окружение", TEMPLATE: "Шаблон",
};

export function PlanDrawer({ bootstrap, refreshToken, initialSection, onClose, onCityFocus, onTaskSelect, onArchiveRecordSelect, onMutation }: {
  bootstrap: BootstrapDto;
  refreshToken: number;
  initialSection: "cities" | "archive";
  onClose: () => void;
  onCityFocus: (city: PlanCityDto) => void;
  onTaskSelect: (taskId: string) => void;
  onArchiveRecordSelect: (recordId: string) => void;
  onMutation: () => Promise<void>;
}) {
  const [cityId, setCityId] = useState(bootstrap.initialCity?.id ?? "");
  const [districtId, setDistrictId] = useState("");
  const [cities, setCities] = useState<PlanCityDto[]>([]);
  const [districts, setDistricts] = useState<PlanDistrictDto[]>([]);
  const [tasks, setTasks] = useState<PlanTaskDto[]>([]);
  const [archiveSelected, setArchiveSelected] = useState(initialSection === "archive");
  const [archiveRecords, setArchiveRecords] = useState<ArchiveRecordDto[]>([]);
  const [citiesLoading, setCitiesLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [deletingId, setDeletingId] = useState("");
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
    if (!cityId || archiveSelected) { setDistricts([]); return; }
    const controller = new AbortController();
    setError("");
    void api<PlanDistrictDto[]>(`/api/plan/cities/${cityId}/districts`, { signal: controller.signal })
      .then(setDistricts)
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "Не удалось загрузить районы");
      });
    return () => controller.abort();
  }, [archiveSelected, cityId, refreshToken, reload]);

  useEffect(() => {
    const controller = new AbortController();
    void api<ArchiveRecordDto[]>("/api/archive/records", { signal: controller.signal })
      .then(setArchiveRecords)
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "Не удалось загрузить Государственный архив");
      });
    return () => controller.abort();
  }, [bootstrap.country.id, refreshToken, reload]);

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
    setArchiveSelected(false);
    setCityId(nextCityId);
    setDistrictId("");
    const city = cities.find((candidate) => candidate.id === nextCityId);
    if (city) onCityFocus(city);
  };
  const canEdit = bootstrap.countryRole !== "VIEWER";
  const removeEntity = async (path: string, id: string, label: string, field: "confirmName" | "confirmTitle") => {
    const confirmation = window.prompt(`Удаление нельзя отменить. Введите точное название:\n${label}`);
    if (confirmation == null) return;
    setError(""); setDeletingId(id);
    try {
      await api(path, { method: "DELETE", json: { [field]: confirmation, idempotencyKey: crypto.randomUUID() } });
      if (id === cityId) { setCityId(""); setDistrictId(""); }
      if (id === districtId) setDistrictId("");
      setReload((value) => value + 1);
      await onMutation();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось удалить объект");
    } finally { setDeletingId(""); }
  };

  return <aside ref={drawerRef} className="plan-drawer" aria-label="План страны">
    <header className="plan-head"><div><p className="eyebrow">ПЛАН СТРАНЫ</p><strong>{bootstrap.country.name}</strong></div><button onClick={onClose} aria-label="Закрыть план">×</button></header>
    {error && <div className="plan-error" role="alert">{error} <button onClick={() => setReload((value) => value + 1)}>Повторить</button></div>}
    <div className="plan-columns">
      <section><h3>Страна</h3>
        <div className="plan-row archive-row"><button className={archiveSelected ? "selected" : ""} onClick={() => { setArchiveSelected(true); setCityId(""); setDistrictId(""); }}>
          <i aria-hidden="true">▣</i><span><strong>Государственный архив</strong><small>Уровень {bootstrap.archive.stage} · {bootstrap.archive.recordCount} записей</small></span>
        </button></div>
        <h3 className="plan-subheading">Города <span>{bootstrap.stats.cities}</span></h3>
        {citiesLoading && !error && <p className="plan-placeholder">Загружаем города…</p>}
        {!citiesLoading && cities.length === 0 && !error && <p className="plan-placeholder">Нет городов</p>}
        {cities.map((city) => <div key={city.id} className="plan-row"><button className={city.id === cityId ? "selected" : ""} onClick={() => chooseCity(city.id)}>
          <i>▦</i><span><strong>{city.name}</strong>{city.description && <small>{city.description.slice(0, 64)}</small>}{city.taskCount > 0 && <small>{city.taskCount} зданий</small>}</span>
        </button>{canEdit && <button className="plan-delete" disabled={Boolean(deletingId)} title={`Удалить город «${city.name}»`} aria-label={`Удалить город «${city.name}»`} onClick={() => void removeEntity(`/api/cities/${city.id}`, city.id, city.name, "confirmName")}>{deletingId === city.id ? "…" : "×"}</button>}</div>)}
      </section>
      {archiveSelected ? <section className="plan-tasks plan-archive-records"><h3>Записи архива <span>{archiveRecords.length}</span></h3>
        <p className="plan-section-note">Короткий устойчивый контекст проекта. Текущая работа остаётся в задачах.</p>
        {archiveRecords.length === 0 && !error && <p className="plan-placeholder">Архив пока пуст</p>}
        {archiveRecords.map((record) => <div key={record.id} className="plan-row"><button onClick={() => onArchiveRecordSelect(record.id)}>
          <i className={`reference-kind-dot kind-${record.kind.toLowerCase()}`} /><span><strong>{record.title}</strong><small>{kindLabel[record.kind]}{record.body ? ` · ${record.body.slice(0, 72)}` : ""}</small></span>
        </button>{canEdit && <button className="plan-delete" disabled={Boolean(deletingId)} title={`Удалить запись «${record.title}»`} aria-label={`Удалить запись «${record.title}»`} onClick={() => void removeEntity(`/api/archive/records/${record.id}`, record.id, record.title, "confirmTitle")}>{deletingId === record.id ? "…" : "×"}</button>}</div>)}
      </section> : <>
      <section><h3>Районы <span>{districts.length}</span></h3>
        {!cityId && <p className="plan-placeholder">Выберите город</p>}
        {cityId && districts.length === 0 && !error && <p className="plan-placeholder">Загружаем районы…</p>}
        {districts.map((district) => <div key={district.id} className="plan-row"><button className={district.id === districtId ? "selected" : ""} onClick={() => setDistrictId(district.id)}>
          <i className={`district-dot district-${district.status.toLowerCase()}`} /><span><strong>{district.name}</strong><small>{districtStatus[district.status]} · {district.taskCount} задач{district.deadline ? ` · до ${new Date(district.deadline).toLocaleDateString("ru-RU")}` : ""}</small></span>
        </button>{canEdit && <button className="plan-delete" disabled={Boolean(deletingId)} title={`Удалить район «${district.name}»`} aria-label={`Удалить район «${district.name}»`} onClick={() => void removeEntity(`/api/districts/${district.id}`, district.id, district.name, "confirmName")}>{deletingId === district.id ? "…" : "×"}</button>}</div>)}
      </section>
      <section className="plan-tasks"><h3>Задачи <span>{tasks.length}</span></h3>
        {!districtId && <p className="plan-placeholder">Выберите район</p>}
        {districtId && tasks.length === 0 && !error && <p className="plan-placeholder">В районе пока нет задач</p>}
        {tasks.map((task) => <div key={task.id} className="plan-row"><button onClick={() => onTaskSelect(task.id)}>
          <i className={`task-stage-dot stage-${task.stage}`}>{task.stage}</i><span><strong>#{task.taskNumber} · {task.title}</strong><small>{taskType[task.workItemType]} · {taskStatus[task.status]} · {task.progress}% · {task.estimate} SP{task.activeDefectCount > 0 ? ` · ${task.activeDefectCount} деф.` : ""}</small></span>
        </button></div>)}
      </section>
      </>}
    </div>
  </aside>;
}
