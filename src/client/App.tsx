import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import type { BootstrapDto, CityDto, RealtimeEvent, Rect } from "../shared/contracts";
import { api, ApiError } from "./api";
import { AuthScreen } from "./components/AuthScreen";
import { Button, cx } from "./components/ui";

const WorldCanvas = lazy(() => import("./components/WorldCanvas").then((module) => ({ default: module.WorldCanvas })));
const CountryPanel = lazy(() => import("./components/CountryPanel").then((module) => ({ default: module.CountryPanel })));
const PlanDrawer = lazy(() => import("./components/PlanDrawer").then((module) => ({ default: module.PlanDrawer })));
const TaskModal = lazy(() => import("./components/TaskModal").then((module) => ({ default: module.TaskModal })));
const TokenPanel = lazy(() => import("./components/TokenPanel").then((module) => ({ default: module.TokenPanel })));

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
    let active = true;
    let disconnect: (() => void) | undefined;
    void import("socket.io-client").then(({ io }) => {
      if (!active) return;
      const socket = io({ path: "/socket.io", withCredentials: true });
      disconnect = () => socket.disconnect();
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
    });
    return () => { active = false; disconnect?.(); };
  }, [countryId, load]);

  if (sessionState === "INITIALIZING" && !bootstrap) return <div className="app-loading" role="status"><div className="loader-square" /><span>Открываем страну…</span></div>;
  if (sessionState === "ANONYMOUS" || sessionState === "RECOVERABLE_ERROR" || !bootstrap) {
    return <AuthScreen initialError={sessionState === "RECOVERABLE_ERROR" ? authError : ""} onAuthenticated={load} />;
  }

  const activeCity = focusCity ?? bootstrap.initialCity;
  return <main className="grid h-full grid-rows-[72px_minmax(0,1fr)] bg-[#081316]">
    <header className="relative z-10 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-[#2c454d] bg-[#0e1d21]/95 px-3 shadow-[0_8px_28px_#0003] backdrop-blur-xl md:grid-cols-[minmax(0,1.2fr)_auto_auto] md:px-5" aria-label="Панель управления страной">
      <div className="flex min-w-0 items-center gap-2.5 md:gap-4">
        <div className="brand-mark hidden shrink-0 xl:flex"><span>▦</span> TASKTOPIA</div>
        <button className="country-title-button grid min-w-0 border-0 border-l-0 px-0 text-left xl:border-l xl:border-[#304850] xl:pl-5" onClick={() => setCountriesOpen(true)}>
          <span className="text-[9px] font-black tracking-[.16em] text-[#81979b]">СТРАНА · ПРОЕКТ</span>
          <strong className="block max-w-[180px] truncate text-sm text-[#edf0e7] md:max-w-[240px]">{bootstrap.country.name}</strong>
        </button>
        {activeCity && <div className="hidden min-w-0 border-l border-[#304850] pl-4 sm:grid">
          <span className="text-[9px] font-black tracking-[.16em] text-[#81979b]">ГОРОД · ЭПИК</span>
          <strong className="block max-w-[180px] truncate text-sm text-[#edf0e7]">{activeCity.name}</strong>
        </div>}
      </div>

      <div className="hidden items-center gap-4 text-xs text-[#9cafb2] md:flex xl:gap-6">
        <span className="flex items-center gap-2 whitespace-nowrap"><i className={cx("h-2 w-2 rounded-full", online ? "bg-[#78be6d] shadow-[0_0_8px_#78be6d]" : "bg-[#d66e5d]")} />{online ? "В сети" : "Подключение"}</span>
        <span className="hidden whitespace-nowrap lg:inline">{bootstrap.stats.cities} городов</span>
        <span className="hidden whitespace-nowrap xl:inline">{bootstrap.stats.districts} районов</span>
        <span className="hidden whitespace-nowrap xl:inline">{bootstrap.stats.tasks} задач</span>
      </div>

      <nav className="flex items-center justify-end gap-1.5 sm:gap-2" aria-label="Действия карты">
        <Button className={cx("min-h-10 px-3 text-xs sm:px-4", planOpen && "border-skyline bg-[#1a3942] text-white")} onClick={() => setPlanOpen((value) => !value)}>План</Button>
        <Button className={cx("hidden min-h-10 px-3 text-xs sm:inline-flex sm:px-4", showDistricts && "border-skyline bg-[#1a3942] text-white")} aria-pressed={showDistricts} onClick={() => setShowDistricts((value) => !value)}>Районы</Button>
        <Button className="h-10 min-h-10 w-10 px-0 text-lg text-signal" onClick={() => openSettings("mcp")} title="MCP-интеграции" aria-label="MCP-интеграции">⌁</Button>
        <Button className="h-10 min-h-10 w-10 rounded-full px-0 text-xs text-skyline" onClick={() => openSettings("account")} title="Настройки аккаунта" aria-label="Настройки аккаунта">{bootstrap.user.name.slice(0, 1).toUpperCase()}</Button>
      </nav>
    </header>

    <section className="map-region">
      {bootstrap.stats.cities > 0 ? <>
        <Suspense fallback={<div className="app-loading" role="status"><div className="loader-square" /><span>Загружаем карту…</span></div>}>
          <WorldCanvas key={bootstrap.country.id} countryId={bootstrap.country.id} chunkSize={bootstrap.chunkSize} viewBounds={bootstrap.viewBounds} focusCity={activeCity} invalidation={mapInvalidation} showDistricts={showDistricts} onTaskSelect={setSelectedTask} />
        </Suspense>
        <div className="map-help"><span>Перетаскивание — движение</span><span>Колесо — масштаб</span><span>Здание — карточка задачи</span></div>
      </> : <div className="world-empty"><div className="empty-square" aria-hidden="true">＋</div><h2>Создайте первый город через MCP</h2><p>Подключите Tasktopia к MCP-клиенту, затем попросите его создать город. Карта обновится автоматически.</p><button className="primary-button" onClick={() => openSettings("mcp")}>Подключить MCP</button></div>}
      {planOpen && <Suspense fallback={null}><PlanDrawer bootstrap={bootstrap} refreshToken={revision} onClose={() => setPlanOpen(false)} onCityFocus={(city) => { setFocusCity(city); setPlanOpen(false); }} onTaskSelect={setSelectedTask} /></Suspense>}
    </section>

    {selectedTask && <Suspense fallback={null}><TaskModal taskId={selectedTask} revision={revision} onClose={closeTask} /></Suspense>}
    {countriesOpen && <Suspense fallback={null}><CountryPanel bootstrap={bootstrap} onClose={() => setCountriesOpen(false)} onBootstrap={applyBootstrap} /></Suspense>}
    {tokensOpen && <Suspense fallback={null}><TokenPanel bootstrap={bootstrap} initialSection={settingsSection} onClose={closeSettings} onAccountChanged={load} onLogout={logout} /></Suspense>}
  </main>;
}
