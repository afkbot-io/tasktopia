import { useMemo, useState } from "react";
import type { BootstrapDto, DistrictDto, TaskDto } from "../../shared/contracts";

const districtStatus: Record<DistrictDto["status"], string> = {
  PLANNED: "Запланирован", ACTIVE: "Строится", COMPLETED: "Завершён",
};

const taskStatus: Record<TaskDto["status"], string> = {
  PLANNING: "Планирование", STARTED: "В работе · 0%", IN_PROGRESS: "В работе", TESTING: "Тестирование", COMPLETED: "Завершено",
};

export function PlanDrawer({ bootstrap, onClose, onCityFocus, onTaskSelect }: {
  bootstrap: BootstrapDto;
  onClose: () => void;
  onCityFocus: (cityId: string) => void;
  onTaskSelect: (taskId: string) => void;
}) {
  const [cityId, setCityId] = useState(bootstrap.cities[0]?.id ?? "");
  const [districtId, setDistrictId] = useState("");
  const districts = useMemo(() => bootstrap.districts.filter((district) => district.cityId === cityId), [bootstrap.districts, cityId]);
  const tasks = useMemo(() => bootstrap.tasks.filter((task) => task.districtId === districtId), [bootstrap.tasks, districtId]);

  const chooseCity = (nextCityId: string) => {
    setCityId(nextCityId);
    setDistrictId("");
    onCityFocus(nextCityId);
  };

  return <aside className="plan-drawer" aria-label="План страны">
    <header className="plan-head"><div><p className="eyebrow">ПЛАН СТРАНЫ</p><strong>{bootstrap.country.name}</strong></div><button onClick={onClose} aria-label="Закрыть план">×</button></header>
    <div className="plan-columns">
      <section><h3>Города <span>{bootstrap.cities.length}</span></h3>
        {bootstrap.cities.map((city) => {
          const count = bootstrap.tasks.filter((task) => task.cityId === city.id).length;
          return <button key={city.id} className={city.id === cityId ? "selected" : ""} onClick={() => chooseCity(city.id)}>
            <i>▦</i><span><strong>{city.name}</strong><small>{count} задач</small></span>
          </button>;
        })}
      </section>
      <section><h3>Районы <span>{districts.length}</span></h3>
        {!cityId && <p className="plan-placeholder">Выберите город</p>}
        {districts.map((district) => {
          const count = bootstrap.tasks.filter((task) => task.districtId === district.id).length;
          return <button key={district.id} className={district.id === districtId ? "selected" : ""} onClick={() => setDistrictId(district.id)}>
            <i className={`district-dot district-${district.status.toLowerCase()}`} /><span><strong>{district.name}</strong><small>{districtStatus[district.status]} · {count} задач</small></span>
          </button>;
        })}
      </section>
      <section className="plan-tasks"><h3>Задачи <span>{tasks.length}</span></h3>
        {!districtId && <p className="plan-placeholder">Выберите район</p>}
        {tasks.map((task) => <button key={task.id} onClick={() => onTaskSelect(task.id)}>
          <i className={`task-stage-dot stage-${task.stage}`}>{task.stage}</i><span><strong>{task.title}</strong><small>{taskStatus[task.status]} · {task.progress}% · {task.estimate} SP</small></span>
        </button>)}
      </section>
    </div>
  </aside>;
}
