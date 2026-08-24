import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { BootstrapDto, CityDto, RealtimeEvent, TaskSearchResultDto } from "../shared/contracts";
import type { CountryAtlasCityDto } from "../shared/country-atlas-contract";
import { enqueueCountryAtlasEvent } from "../shared/country-atlas-events";
import { api, ApiError } from "./api";
import { AuthScreen } from "./components/AuthScreen";
import { CountryPanel } from "./components/CountryPanel";
import { CountrySwitcher } from "./components/CountrySwitcher";
import { PlanDrawer } from "./components/PlanDrawer";
import { TaskSearch } from "./components/TaskSearch";
import { Button, cx } from "./components/ui";
import { eventInvalidation, type MapInvalidation } from "./map-invalidation";

const WorldCanvas = lazy(() => import("./components/WorldCanvas").then((module) => ({ default: module.WorldCanvas })));
const CountryAtlasCanvas = lazy(() => import("./components/CountryAtlasCanvas").then((module) => ({ default: module.CountryAtlasCanvas })));
const TaskModal = lazy(() => import("./components/TaskModal").then((module) => ({ default: module.TaskModal })));
const ArchiveRecordModal = lazy(() => import("./components/ArchiveRecordModal").then((module) => ({ default: module.ArchiveRecordModal })));
const TokenPanel = lazy(() => import("./components/TokenPanel").then((module) => ({ default: module.TokenPanel })));

type SessionState = "INITIALIZING" | "ANONYMOUS" | "AUTHENTICATED" | "RECOVERABLE_ERROR";
type RealtimeNotice = { id: number; text: string; tone: "info" | "success" };
type CityFocus = Pick<CityDto, "id" | "name" | "center" | "bounds">;

function playCompletionChime(): void {
  if (document.hidden) return;
  const AudioContextClass = window.AudioContext;
  if (!AudioContextClass) return;
  try {
    const context = new AudioContextClass();
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.055, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.42);
    gain.connect(context.destination);
    for (const [offset, frequency] of [[0, 659], [0.12, 784], [0.24, 988]] as const) {
      const oscillator = context.createOscillator();
      oscillator.type = "triangle"; oscillator.frequency.value = frequency; oscillator.connect(gain);
      oscillator.start(context.currentTime + offset); oscillator.stop(context.currentTime + offset + 0.18);
    }
    window.setTimeout(() => { void context.close(); }, 900);
  } catch { /* Audio is optional when the browser has not granted activation. */ }
}

export function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapDto | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>("INITIALIZING");
  const [authError, setAuthError] = useState("");
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [selectedArchiveRecord, setSelectedArchiveRecord] = useState<string | null>(null);
  const [tokensOpen, setTokensOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<"mcp" | "account">("mcp");
  const [planOpen, setPlanOpen] = useState(false);
  const [planSection, setPlanSection] = useState<"cities" | "archive">("cities");
  const [countryMenuOpen, setCountryMenuOpen] = useState(false);
  const [countryDialog, setCountryDialog] = useState<"manage" | "create" | null>(null);
  const [showDistricts, setShowDistricts] = useState(false);
  const [mapMode, setMapMode] = useState<"ATLAS" | "CITY">("ATLAS");
  const [focusCity, setFocusCity] = useState<CityFocus | null>(null);
  const [hoveredAtlasCity, setHoveredAtlasCity] = useState<CityFocus | null>(null);
  const [focusTask, setFocusTask] = useState<{ origin: { x: number; y: number }; token: number } | null>(null);
  const deepLinkHandledRef = useRef(false);
  const eventCountryRef = useRef<string | undefined>(undefined);
  const lastWorldEventIdRef = useRef(0);
  const [revision, setRevision] = useState(0);
  const [mapInvalidation, setMapInvalidation] = useState<MapInvalidation>();
  const [atlasEvents, setAtlasEvents] = useState<RealtimeEvent[]>([]);
  const [online, setOnline] = useState(true);
  const [notices, setNotices] = useState<RealtimeNotice[]>([]);
  const countryId = bootstrap?.country.id;
  const closeTask = useCallback(() => setSelectedTask(null), []);
  const closeArchiveRecord = useCallback(() => setSelectedArchiveRecord(null), []);
  const closeSettings = useCallback(() => setTokensOpen(false), []);
  const openSettings = useCallback((section: "mcp" | "account") => {
    setSettingsSection(section);
    setTokensOpen(true);
  }, []);
  const openArchive = useCallback(() => {
    setPlanSection("archive");
    setPlanOpen(true);
  }, []);
  const hoverAtlasCity = useCallback((city: CountryAtlasCityDto | null) => {
    setHoveredAtlasCity(city ? { id: city.id, name: city.name, center: city.sourceCenter, bounds: city.sourceBounds } : null);
  }, []);
  const acknowledgeAtlasEvents = useCallback((eventId: number) => {
    setAtlasEvents((current) => current.filter((event) => event.id > eventId));
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
    if (eventCountryRef.current !== next.country.id) {
      eventCountryRef.current = next.country.id;
      lastWorldEventIdRef.current = next.eventCursor;
      setAtlasEvents([]);
    }
    setBootstrap(next);
    setFocusCity(next.initialCity);
    setHoveredAtlasCity(null);
    setMapMode(next.stats.cities > 1 ? "ATLAS" : "CITY");
    setSelectedTask(null);
    setRevision((value) => value + 1);
    setCountryMenuOpen(false);
  }, []);

  const load = useCallback(async () => {
    setSessionState((current) => current === "AUTHENTICATED" ? current : "INITIALIZING");
    try {
      const next = await api<BootstrapDto>("/api/bootstrap");
      if (eventCountryRef.current !== next.country.id) {
        eventCountryRef.current = next.country.id;
        lastWorldEventIdRef.current = next.eventCursor;
      }
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
  const refreshWorld = useCallback(async () => {
    applyBootstrap(await api<BootstrapDto>("/api/bootstrap"));
  }, [applyBootstrap]);

  useEffect(() => { void load().catch(() => undefined); }, [load]);
  useEffect(() => {
    document.title = bootstrap ? `Tasktopia — ${bootstrap.country.name}` : "Tasktopia — цифровая страна";
  }, [bootstrap]);

  // Shareable task links: /task/<number> opens the card (and focuses its
  // building) once the session is ready. Anonymous visitors get the auth
  // screen first and land on the card after signing in.
  useEffect(() => {
    if (!bootstrap || deepLinkHandledRef.current) return;
    const match = /^\/task\/(\d{1,9})\/?$/.exec(window.location.pathname);
    if (!match) return;
    deepLinkHandledRef.current = true;
    const number = Number(match[1]);
    void api<TaskSearchResultDto[]>(`/api/tasks/search?q=${number}&limit=1`)
      .then((found) => {
        const result = found.find((item) => item.taskNumber === number);
        if (!result) return;
        setFocusTask({ origin: result.origin, token: Date.now() });
        setSelectedTask(result.id);
      })
      .catch(() => undefined);
  }, [bootstrap]);

  const openTaskFromSearch = useCallback((result: TaskSearchResultDto) => {
    setMapMode("CITY");
    setFocusTask({ origin: result.origin, token: Date.now() });
    setSelectedTask(result.id);
  }, []);
  const applyRealtimeEvent = useCallback((event: RealtimeEvent) => {
    if (event.countryId !== countryId || event.id <= lastWorldEventIdRef.current) return;
    lastWorldEventIdRef.current = event.id;
    setMapInvalidation(eventInvalidation(event));
    setAtlasEvents((current) => enqueueCountryAtlasEvent(current, event));
    const completed = event.type === "task.status_changed" && event.payload.status === "COMPLETED";
    if (event.type.startsWith("task.") && event.type !== "task.comment_added") {
      const notice: RealtimeNotice = {
        id: event.id,
        text: completed ? "Здание завершено — город обновлён" : event.type === "task.created" ? "Новое здание добавлено на карту" : "Задача обновлена на карте",
        tone: completed ? "success" : "info",
      };
      setNotices((current) => [...current.filter((item) => item.id !== notice.id), notice].slice(-3));
      window.setTimeout(() => setNotices((current) => current.filter((item) => item.id !== notice.id)), completed ? 8_000 : 5_000);
      if (completed) playCompletionChime();
    }
    if (event.type === "task.comment_added" || event.type === "task.status_changed") {
      setBootstrap((current) => current
        ? { ...current, country: { ...current.country, worldVersion: event.worldVersion }, eventCursor: event.id }
        : current);
      setRevision((value) => value + 1);
      return;
    }
    void load().then(() => setRevision((value) => value + 1)).catch(() => setOnline(false));
  }, [countryId, load]);
  useEffect(() => {
    if (!countryId) return;
    let active = true;
    let disconnect: (() => void) | undefined;
    void import("socket.io-client").then(({ io }) => {
      if (!active) return;
      const socket = io({ path: "/socket.io", withCredentials: true });
      disconnect = () => socket.disconnect();
      let replaying = true;
      let buffered: RealtimeEvent[] = [];
      const receive = (event: RealtimeEvent) => {
        if (event.countryId !== countryId) return;
        if (replaying) buffered.push(event);
        else applyRealtimeEvent(event);
      };
      socket.on("connect", () => {
        setOnline(true);
        replaying = true;
        void (async () => {
          const replayed: RealtimeEvent[] = [];
          let cursor = lastWorldEventIdRef.current;
          while (active && socket.connected) {
            const page = await api<RealtimeEvent[]>(`/api/events?after=${cursor}`);
            replayed.push(...page);
            if (page.length < 500) break;
            cursor = page.at(-1)!.id;
          }
          if (!active || !socket.connected) return;
          const pending = [...replayed, ...buffered].sort((left, right) => left.id - right.id);
          buffered = [];
          replaying = false;
          for (const event of pending) applyRealtimeEvent(event);
        })().catch(() => {
          replaying = false;
          const pending = buffered.sort((left, right) => left.id - right.id);
          buffered = [];
          for (const event of pending) applyRealtimeEvent(event);
          setOnline(false);
        });
      });
      socket.on("disconnect", () => setOnline(false));
      socket.on("world:event", receive);
    });
    return () => { active = false; disconnect?.(); };
  }, [applyRealtimeEvent, countryId]);

  if (sessionState === "INITIALIZING" && !bootstrap) return <div className="app-loading" role="status"><div className="loader-square" /><span>Открываем страну…</span></div>;
  if (sessionState === "ANONYMOUS" || sessionState === "RECOVERABLE_ERROR" || !bootstrap) {
    return <AuthScreen initialError={sessionState === "RECOVERABLE_ERROR" ? authError : ""} onAuthenticated={load} />;
  }

  const activeCity = focusCity ?? bootstrap.initialCity;
  const effectiveMapMode = bootstrap.stats.cities > 1 ? mapMode : "CITY";
  const headerCity = effectiveMapMode === "ATLAS" ? hoveredAtlasCity : activeCity;
  return <main className="grid h-full grid-rows-[auto_minmax(0,1fr)] bg-[#081316]">
    <header className="app-header relative z-10 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-[#2c454d] bg-[#0e1d21]/95 px-3 py-1.5 shadow-[0_8px_28px_#0003] backdrop-blur-xl md:grid-cols-[minmax(0,1fr)_minmax(240px,380px)_minmax(0,1fr)] md:gap-3 md:px-4 md:py-0" aria-label="Панель управления страной">
      <div className="order-1 flex min-w-0 items-center gap-2.5 md:gap-4">
        <div className="brand-mark hidden shrink-0 xl:flex"><span>▦</span> TASKTOPIA</div>
        <div className="relative min-w-0">
        <button className="country-title-button grid min-w-0 border-0 border-l-0 px-0 text-left xl:border-l xl:border-[#304850] xl:pl-5" aria-haspopup="dialog" aria-expanded={countryMenuOpen} onClick={() => { setPlanOpen(false); setCountryMenuOpen((value) => !value); }}>
          <span className="text-[9px] font-black tracking-[.16em] text-[#81979b]">СТРАНА</span>
          <strong className="block max-w-[180px] truncate text-sm text-[#edf0e7] md:max-w-[240px]">{bootstrap.country.name}</strong>
        </button>
        {countryMenuOpen && <CountrySwitcher bootstrap={bootstrap} onClose={() => setCountryMenuOpen(false)} onBootstrap={applyBootstrap} onPlan={() => { setCountryMenuOpen(false); setPlanSection("cities"); setPlanOpen(true); }} onManage={() => { setCountryMenuOpen(false); setCountryDialog("manage"); }} onCreate={() => { setCountryMenuOpen(false); setCountryDialog("create"); }} />}
        </div>
        {headerCity && <div className="header-city hidden min-w-0 border-l border-[#304850] pl-4 sm:grid" aria-live="polite">
          <span className="text-[9px] font-black tracking-[.16em] text-[#81979b]">ГОРОД</span>
          <strong className="block max-w-[180px] truncate text-sm text-[#edf0e7]">{headerCity.name}</strong>
        </div>}
      </div>

      <div className="header-search order-3 col-span-2 min-w-0 md:order-2 md:col-span-1">
        <TaskSearch onSelect={openTaskFromSearch} />
      </div>

      <div className="order-2 flex min-w-0 items-center justify-end gap-2 md:order-3">
        <div className="hidden items-center gap-3 text-[11px] text-[#9cafb2] lg:flex">
          <span className="flex items-center gap-1.5 whitespace-nowrap"><i className={cx("h-2 w-2 rounded-full", online ? "bg-[#78be6d] shadow-[0_0_8px_#78be6d]" : "bg-[#d66e5d]")} />{online ? "В сети" : "Подключение"}</span>
          <span className="hidden whitespace-nowrap 2xl:inline">Районов · {bootstrap.stats.activeDistricts}</span>
          <span className="hidden whitespace-nowrap 2xl:inline">Зданий · {bootstrap.stats.unfinishedBuildings}</span>
        </div>
        <nav className="flex items-center justify-end gap-1.5" aria-label="Действия карты">
          {bootstrap.stats.cities > 1 && <Button className={cx("header-control map-mode-button min-h-0 px-3 text-xs", effectiveMapMode === "ATLAS" && "!border-signal !bg-[#3a321d] !text-signal")} aria-pressed={effectiveMapMode === "ATLAS"} aria-label="Карта" title={effectiveMapMode === "ATLAS" ? "Вернуться в выбранный город" : "Открыть карту страны"} onClick={() => { setHoveredAtlasCity(null); setMapMode((value) => value === "ATLAS" ? "CITY" : "ATLAS"); }}><span>Карта</span></Button>}
          {effectiveMapMode === "CITY" && <Button className={cx("header-control min-h-0 px-3 text-xs", showDistricts && "!border-skyline !bg-[#1a3942] !text-white")} aria-pressed={showDistricts} onClick={() => setShowDistricts((value) => !value)}>Границы</Button>}
          <Button className="header-control account-button min-h-0 px-0 text-xs text-skyline" onClick={() => openSettings("account")} title="Настройки аккаунта" aria-label="Настройки аккаунта">{bootstrap.user.name.slice(0, 1).toUpperCase()}</Button>
        </nav>
      </div>
    </header>

    <section className="map-region">
      {bootstrap.stats.cities > 0 ? <>
        <Suspense fallback={<div className="app-loading" role="status"><div className="loader-square" /><span>Загружаем карту…</span></div>}>
          {effectiveMapMode === "ATLAS"
            ? <CountryAtlasCanvas
                key={bootstrap.country.id}
                countryId={bootstrap.country.id}
                activeCityId={activeCity?.id}
                events={atlasEvents}
                onEventsProcessed={acknowledgeAtlasEvents}
                onCitySelect={(city) => {
                  setFocusCity({ id: city.id, name: city.name, center: city.sourceCenter, bounds: city.sourceBounds });
                  setHoveredAtlasCity(null);
                  setMapMode("CITY");
                }}
                onDistrictSelect={(city, district) => {
                  setFocusCity({ id: city.id, name: city.name, center: district.sourceCenter, bounds: district.sourceBounds });
                  setHoveredAtlasCity(null);
                  setSelectedTask(null);
                  setMapMode("CITY");
                }}
                onCityHover={hoverAtlasCity}
              />
            : <WorldCanvas key={bootstrap.country.id} countryId={bootstrap.country.id} chunkSize={bootstrap.chunkSize} worldManifest={bootstrap.worldManifest} viewBounds={bootstrap.viewBounds} focusCity={activeCity} focusTask={focusTask} invalidation={mapInvalidation} showDistricts={showDistricts} onTaskSelect={setSelectedTask} onArchiveSelect={openArchive} />}
        </Suspense>
      </> : <div className="world-empty"><div className="empty-square" aria-hidden="true">＋</div><h2>Создайте первый город через MCP</h2><p>Подключите Tasktopia к MCP-клиенту, затем попросите его создать город. Карта обновится автоматически.</p><button className="primary-button" onClick={() => openSettings("mcp")}>Подключить MCP</button></div>}
      {planOpen && <PlanDrawer bootstrap={bootstrap} refreshToken={revision} initialSection={planSection} onClose={() => setPlanOpen(false)} onCityFocus={(city) => { setFocusCity(city); setMapMode("CITY"); setPlanOpen(false); }} onTaskSelect={setSelectedTask} onArchiveRecordSelect={setSelectedArchiveRecord} onMutation={refreshWorld} />}
    </section>

    {selectedTask && <Suspense fallback={null}><TaskModal taskId={selectedTask} revision={revision} onClose={closeTask} /></Suspense>}
    {selectedArchiveRecord && <Suspense fallback={null}><ArchiveRecordModal recordId={selectedArchiveRecord} onClose={closeArchiveRecord} /></Suspense>}
    {countryDialog && <CountryPanel bootstrap={bootstrap} mode={countryDialog} onClose={() => setCountryDialog(null)} onBootstrap={applyBootstrap} />}
    {tokensOpen && <Suspense fallback={null}><TokenPanel bootstrap={bootstrap} initialSection={settingsSection} onClose={closeSettings} onAccountChanged={load} onLogout={logout} /></Suspense>}
    <aside className="realtime-notices" aria-live="polite" aria-label="Обновления города">
      {notices.map((notice) => <button key={notice.id} className={`realtime-notice realtime-notice-${notice.tone}`} onClick={() => setNotices((current) => current.filter((item) => item.id !== notice.id))}>{notice.text}<span aria-hidden="true">×</span></button>)}
    </aside>
  </main>;
}
