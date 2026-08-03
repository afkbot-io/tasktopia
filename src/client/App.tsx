import { useCallback, useEffect, useState } from "react";
import { io } from "socket.io-client";
import type { BootstrapDto } from "../shared/contracts";
import { api, ApiError } from "./api";
import { AuthScreen } from "./components/AuthScreen";
import { CountryPanel } from "./components/CountryPanel";
import { PlanDrawer } from "./components/PlanDrawer";
import { TaskModal } from "./components/TaskModal";
import { TokenPanel } from "./components/TokenPanel";
import { WorldCanvas } from "./components/WorldCanvas";

export function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapDto | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [authError, setAuthError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [tokensOpen, setTokensOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [countriesOpen, setCountriesOpen] = useState(false);
  const [showDistricts, setShowDistricts] = useState(false);
  const [focusCityId, setFocusCityId] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [online, setOnline] = useState(true);
  const countryId = bootstrap?.country.id;
  const closeTask = useCallback(() => setSelectedTask(null), []);

  const logout = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" });
    setBootstrap(null);
    setAuthRequired(true);
    setTokensOpen(false);
  }, []);

  const applyBootstrap = useCallback((next: BootstrapDto) => {
    setBootstrap(next);
    setFocusCityId(next.cities[0]?.id);
    setSelectedTask(null);
    setRevision((value) => value + 1);
    setCountriesOpen(false);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await api<BootstrapDto>("/api/bootstrap");
      setBootstrap(next);
      setFocusCityId((current) => current && next.cities.some((city) => city.id === current) ? current : next.cities[0]?.id);
      setAuthRequired(false);
      setAuthError("");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setBootstrap(null);
        setAuthRequired(true);
        setAuthError("");
        return;
      }
      setAuthError(error instanceof Error ? error.message : "Не удалось загрузить страну");
      throw error;
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load().catch(() => undefined); }, [load]);
  useEffect(() => {
    if (!countryId) return;
    const socket = io({ path: "/socket.io", withCredentials: true });
    socket.on("connect", () => setOnline(true));
    socket.on("disconnect", () => setOnline(false));
    socket.on("world:event", () => { void load().then(() => setRevision((value) => value + 1)).catch(() => setOnline(false)); });
    return () => { socket.disconnect(); };
  }, [countryId, load]);

  if (loading && !bootstrap) return <div className="app-loading"><div className="loader-square" /><span>Открываем страну…</span></div>;
  if (authRequired || !bootstrap) return <AuthScreen initialError={authError} onAuthenticated={load} />;

  const activeCity = bootstrap.cities.find((city) => city.id === focusCityId) ?? bootstrap.cities[0];
  return <main className="app-shell app-shell-v3">
    <header className="topbar">
      <div className="brand-mark"><span>▦</span> TASKTOPIA</div>
      <button className="country-title country-title-button" onClick={() => setCountriesOpen(true)}><span>СТРАНА</span><strong>{bootstrap.country.name}</strong></button>
      {activeCity && <div className="country-title city-title"><span>ГОРОД</span><strong>{activeCity.name}</strong></div>}
      <div className="topbar-stats">
        <span><i className={online ? "online" : "offline"} />{online ? "Синхронизировано" : "Переподключение"}</span>
        <span>{bootstrap.cities.length} городов</span><span>{bootstrap.districts.length} районов</span><span>{bootstrap.tasks.length} задач</span>
      </div>
      <button className={`topbar-button ${planOpen ? "active" : ""}`} onClick={() => setPlanOpen((value) => !value)}>План</button>
      <button className={`topbar-button ${showDistricts ? "active" : ""}`} aria-pressed={showDistricts} onClick={() => setShowDistricts((value) => !value)}>Районы</button>
      <button className="icon-button" onClick={() => setTokensOpen(true)} title="MCP-интеграции">⌁</button>
      <button className="icon-button account-button" onClick={() => setTokensOpen(true)} title="Настройки аккаунта">{bootstrap.user.name.slice(0, 1).toUpperCase()}</button>
    </header>

    <section className="map-region">
      <WorldCanvas bootstrap={bootstrap} revision={revision} focusCityId={focusCityId} showDistricts={showDistricts} onTaskSelect={setSelectedTask} />
      <div className="map-help"><span>Перетаскивание — движение</span><span>Колесо — масштаб</span><span>Здание — карточка задачи</span></div>
      {planOpen && <PlanDrawer bootstrap={bootstrap} onClose={() => setPlanOpen(false)} onCityFocus={(cityId) => { setFocusCityId(cityId); setPlanOpen(false); }} onTaskSelect={setSelectedTask} />}
      {bootstrap.cities.length === 0 && <div className="world-empty"><div className="empty-square">＋</div><h2>Создайте первый город через MCP</h2><p>Новый город получит территорию, внутренние улицы и дорогу от границы страны.</p><button className="primary-button" onClick={() => setTokensOpen(true)}>Настроить MCP</button></div>}
    </section>

    {selectedTask && <TaskModal taskId={selectedTask} revision={revision} onClose={closeTask} />}
    {countriesOpen && <CountryPanel bootstrap={bootstrap} onClose={() => setCountriesOpen(false)} onBootstrap={applyBootstrap} />}
    {tokensOpen && <TokenPanel bootstrap={bootstrap} onClose={() => setTokensOpen(false)} onAccountChanged={load} onLogout={logout} />}
  </main>;
}
