import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { io } from "socket.io-client";
import type { BootstrapDto, CityDto, RealtimeEvent, Rect } from "../shared/contracts";
import { api, ApiError } from "./api";
import { AuthScreen } from "./components/AuthScreen";
import { CountryPanel } from "./components/CountryPanel";
import { PlanDrawer } from "./components/PlanDrawer";
import { TaskModal } from "./components/TaskModal";
import { TokenPanel } from "./components/TokenPanel";

const WorldCanvas = lazy(() => import("./components/WorldCanvas").then((module) => ({ default: module.WorldCanvas })));

type SessionState = "INITIALIZING" | "ANONYMOUS" | "AUTHENTICATED" | "RECOVERABLE_ERROR";
type MapInvalidation = { id: number; type: string; affectedBounds?: Rect };

function eventInvalidation(event: RealtimeEvent): MapInvalidation {
  const candidate = event.payload.affectedBounds as Partial<Rect> | undefined;
  const affectedBounds = candidate
    && [candidate.minX, candidate.minY, candidate.maxX, candidate.maxY].every(Number.isFinite)
    ? candidate as Rect
    : undefined;
  return { id: event.id, type: event.type, affectedBounds };
}

export function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapDto | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>("INITIALIZING");
  const [authError, setAuthError] = useState("");
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [tokensOpen, setTokensOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<"mcp" | "account">("mcp");
  const [planOpen, setPlanOpen] = useState(false);
  const [countriesOpen, setCountriesOpen] = useState(false);
  const [showDistricts, setShowDistricts] = useState(false);
  const [focusCity, setFocusCity] = useState<CityDto | null>(null);
  const [revision, setRevision] = useState(0);
  const [mapInvalidation, setMapInvalidation] = useState<MapInvalidation>();
  const [online, setOnline] = useState(true);
  const countryId = bootstrap?.country.id;
  const closeTask = useCallback(() => setSelectedTask(null), []);
  const closeSettings = useCallback(() => setTokensOpen(false), []);
  const openSettings = useCallback((section: "mcp" | "account") => {
    setSettingsSection(section);
    setTokensOpen(true);
  }, []);

  const logout = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" });
    setBootstrap(null);
    setFocusCity(null);
    setSessionState("ANONYMOUS");
    setAuthError("");
    setTokensOpen(false);
  }, []);

  const applyBootstrap = useCallback((next: BootstrapDto) => {
    setBootstrap(next);
    setFocusCity(next.initialCity);
    setSelectedTask(null);
    setRevision((value) => value + 1);
    setCountriesOpen(false);
  }, []);

  const load = useCallback(async () => {
    setSessionState((current) => current === "AUTHENTICATED" ? current : "INITIALIZING");
    try {
      const next = await api<BootstrapDto>("/api/bootstrap");
      setBootstrap(next);
      setFocusCity((current) => current ?? next.initialCity);
      setSessionState("AUTHENTICATED");
      setAuthError("");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setBootstrap(null);
        setSessionState("ANONYMOUS");
        setAuthError("");
        return;
      }
      setAuthError(error instanceof Error ? error.message : "Не удалось загрузить страну");
      setSessionState((current) => current === "AUTHENTICATED" ? current : "RECOVERABLE_ERROR");
      throw error;
    }
  }, []);

  useEffect(() => { void load().catch(() => undefined); }, [load]);
  useEffect(() => {
    if (!countryId) return;
    const socket = io({ path: "/socket.io", withCredentials: true });
    socket.on("connect", () => setOnline(true));
    socket.on("disconnect", () => setOnline(false));
    socket.on("world:event", (event: RealtimeEvent) => {
      if (event.countryId !== countryId) return;
      setMapInvalidation(eventInvalidation(event));
      if (event.type === "task.comment_added" || event.type === "task.status_changed") {
        setBootstrap((current) => {
          if (!current) return current;
          return { ...current, country: { ...current.country, worldVersion: event.worldVersion } };
        });
        setRevision((value) => value + 1);
        return;
      }
      void load().then(() => setRevision((value) => value + 1)).catch(() => setOnline(false));
    });
    return () => { socket.disconnect(); };
  }, [countryId, load]);

  if (sessionState === "INITIALIZING" && !bootstrap) return <div className="app-loading" role="status"><div className="loader-square" /><span>Открываем страну…</span></div>;
  if (sessionState === "ANONYMOUS" || sessionState === "RECOVERABLE_ERROR" || !bootstrap) {
    return <AuthScreen initialError={sessionState === "RECOVERABLE_ERROR" ? authError : ""} onAuthenticated={load} />;
  }

  const activeCity = focusCity ?? bootstrap.initialCity;
  return <main className="app-shell app-shell-v3">
    <header className="topbar">
      <div className="brand-mark"><span>▦</span> TASKTOPIA</div>
      <button className="country-title country-title-button" onClick={() => setCountriesOpen(true)}><span>СТРАНА</span><strong>{bootstrap.country.name}</strong></button>
      {activeCity && <div className="country-title city-title"><span>ГОРОД</span><strong>{activeCity.name}</strong></div>}
      <div className="topbar-stats">
        <span><i className={online ? "online" : "offline"} />{online ? "Синхронизировано" : "Переподключение"}</span>
        <span>{bootstrap.stats.cities} городов</span><span>{bootstrap.stats.districts} районов</span><span>{bootstrap.stats.tasks} задач</span>
      </div>
      <button className={`topbar-button ${planOpen ? "active" : ""}`} onClick={() => setPlanOpen((value) => !value)}>План</button>
      <button className={`topbar-button ${showDistricts ? "active" : ""}`} aria-pressed={showDistricts} onClick={() => setShowDistricts((value) => !value)}>Районы</button>
      <button className="icon-button" onClick={() => openSettings("mcp")} title="MCP-интеграции" aria-label="MCP-интеграции">⌁</button>
      <button className="icon-button account-button" onClick={() => openSettings("account")} title="Настройки аккаунта" aria-label="Настройки аккаунта">{bootstrap.user.name.slice(0, 1).toUpperCase()}</button>
    </header>

    <section className="map-region">
      {bootstrap.stats.cities > 0 ? <>
        <Suspense fallback={<div className="app-loading" role="status"><div className="loader-square" /><span>Загружаем карту…</span></div>}>
          <WorldCanvas key={bootstrap.country.id} countryId={bootstrap.country.id} chunkSize={bootstrap.chunkSize} viewBounds={bootstrap.viewBounds} focusCity={activeCity} invalidation={mapInvalidation} showDistricts={showDistricts} onTaskSelect={setSelectedTask} />
        </Suspense>
        <div className="map-help"><span>Перетаскивание — движение</span><span>Колесо — масштаб</span><span>Здание — карточка задачи</span></div>
      </> : <div className="world-empty"><div className="empty-square" aria-hidden="true">＋</div><h2>Создайте первый город через MCP</h2><p>Подключите Tasktopia к MCP-клиенту, затем попросите его создать город. Карта обновится автоматически.</p><button className="primary-button" onClick={() => openSettings("mcp")}>Подключить MCP</button></div>}
      {planOpen && <PlanDrawer bootstrap={bootstrap} refreshToken={revision} onClose={() => setPlanOpen(false)} onCityFocus={(city) => { setFocusCity(city); setPlanOpen(false); }} onTaskSelect={setSelectedTask} />}
    </section>

    {selectedTask && <TaskModal taskId={selectedTask} revision={revision} onClose={closeTask} />}
    {countriesOpen && <CountryPanel bootstrap={bootstrap} onClose={() => setCountriesOpen(false)} onBootstrap={applyBootstrap} />}
    {tokensOpen && <TokenPanel bootstrap={bootstrap} initialSection={settingsSection} onClose={closeSettings} onAccountChanged={load} onLogout={logout} />}
  </main>;
}
