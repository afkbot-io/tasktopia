import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { BootstrapDto, BuildingEventContext, CityDto, RealtimeEvent, TaskSearchResultDto } from "../shared/contracts";
import type { CountryOverviewCityDto } from "../shared/country-overview-contract";
import type { CitySceneDto } from "../shared/city-scene-contract";
import { countryAtlasEventImpact, enqueueCountryAtlasEvent } from "../shared/country-atlas-events";
import { presentRealtimeNotice, type RealtimeNoticePresentation } from "../shared/realtime-notifications";
import { api, ApiError } from "./api";
import { AuthScreen } from "./components/AuthScreen";
import { CountryPanel } from "./components/CountryPanel";
import { CountrySwitcher } from "./components/CountrySwitcher";
import { PlanDrawer } from "./components/PlanDrawer";
import { TaskSearch } from "./components/TaskSearch";
import { Button, cx } from "./components/ui";
import { MapLevelNav, type MapLevel } from "./components/MapLevelNav";
import { MapLevelTransition } from "./components/MapLevelTransition";
import { ProfilePresence } from "./components/ProfilePresence";
import { createAtlasTransition, withAtlasTransitionPhase, type AtlasTransition } from "./atlas-navigation-transition";
import { eventInvalidation, type MapInvalidation } from "./map-invalidation";

const WorldCanvas = lazy(() => import("./components/WorldCanvas").then((module) => ({ default: module.WorldCanvas })));
const CountryOverviewCanvas = lazy(() => import("./components/CountryOverviewCanvas").then((module) => ({ default: module.CountryOverviewCanvas })));
const PlanetAtlasCanvas = lazy(() => import("./components/PlanetAtlasCanvas").then((module) => ({ default: module.PlanetAtlasCanvas })));
const TaskModal = lazy(() => import("./components/TaskModal").then((module) => ({ default: module.TaskModal })));
const ArchiveRecordModal = lazy(() => import("./components/ArchiveRecordModal").then((module) => ({ default: module.ArchiveRecordModal })));
const TokenPanel = lazy(() => import("./components/TokenPanel").then((module) => ({ default: module.TokenPanel })));

type SessionState = "INITIALIZING" | "ANONYMOUS" | "AUTHENTICATED" | "RECOVERABLE_ERROR";
type CityFocus = Pick<CityDto, "id" | "name" | "center" | "bounds">;
type BuildingNavigationTarget = Pick<BuildingEventContext, "id" | "origin" | "city">;

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
  const [mapMode, setMapMode] = useState<MapLevel>("COUNTRY");
  const [mapTransition, setMapTransition] = useState<AtlasTransition | null>(null);
  const mapTransitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapTransitionAbortRef = useRef<AbortController | null>(null);
  const [focusCity, setFocusCity] = useState<CityFocus | null>(null);
  const [preparedCityScene, setPreparedCityScene] = useState<CitySceneDto | null>(null);
  const [hoveredAtlasCity, setHoveredAtlasCity] = useState<CityFocus | null>(null);
  const [focusTask, setFocusTask] = useState<{ origin: { x: number; y: number }; token: number } | null>(null);
  const deepLinkHandledRef = useRef(false);
  const eventCountryRef = useRef<string | undefined>(undefined);
  const lastWorldEventIdRef = useRef(0);
  const [revision, setRevision] = useState(0);
  const [planetRevision, setPlanetRevision] = useState(0);
  const [mapInvalidation, setMapInvalidation] = useState<MapInvalidation>();
  const [atlasEvents, setAtlasEvents] = useState<RealtimeEvent[]>([]);
  const [online, setOnline] = useState(true);
  const [notices, setNotices] = useState<RealtimeNoticePresentation[]>([]);
  const [mapTransitionError, setMapTransitionError] = useState("");
  const cityReadyResolverRef = useRef<(() => void) | null>(null);
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
  const transitionMap = useCallback(async (
    to: MapLevel,
    focus: { x: number; y: number },
    commit: (signal: AbortSignal) => Promise<void> | void,
  ) => {
    mapTransitionAbortRef.current?.abort();
    const controller = new AbortController();
    mapTransitionAbortRef.current = controller;
    if (mapTransitionTimerRef.current) clearTimeout(mapTransitionTimerRef.current);
    const transition = createAtlasTransition(mapMode, to, focus, performance.now());
    setMapTransitionError("");
    setMapTransition(transition);
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (controller.signal.aborted) return;
      setMapTransition((current) => current?.id === transition.id ? withAtlasTransitionPhase(current, "PREPARE") : current);
      await commit(controller.signal);
      if (controller.signal.aborted) return;
      setMapTransition((current) => current?.id === transition.id ? withAtlasTransitionPhase(current, "FIRST_FRAME") : current);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (controller.signal.aborted) return;
      setMapTransition((current) => current?.id === transition.id ? withAtlasTransitionPhase(current, "SWAP") : current);
    } catch (error) {
      if (!controller.signal.aborted) setMapTransitionError(error instanceof Error ? error.message : "Не удалось открыть карту");
    } finally {
      if (!controller.signal.aborted) {
        mapTransitionTimerRef.current = setTimeout(() => {
          setMapTransition((current) => current?.id === transition.id ? withAtlasTransitionPhase(current, "EVICT") : current);
          mapTransitionTimerRef.current = setTimeout(() => {
            setMapTransition((current) => current?.id === transition.id ? null : current);
            if (mapTransitionAbortRef.current === controller) mapTransitionAbortRef.current = null;
            mapTransitionTimerRef.current = null;
          }, 120);
        }, 180);
      }
    }
  }, [mapMode]);
  const hoverAtlasCity = useCallback((city: CountryOverviewCityDto | null) => {
    setHoveredAtlasCity(city ? { id: city.id, name: city.name, center: city.sourceCenter, bounds: city.sourceBounds } : null);
  }, []);
  const acknowledgeAtlasEvents = useCallback((eventId: number) => {
    setAtlasEvents((current) => current.filter((event) => event.id > eventId));
  }, []);

  const logout = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" });
    setBootstrap(null);
    setFocusCity(null);
    setPreparedCityScene(null);
    setSessionState("ANONYMOUS");
    setAuthError("");
    setTokensOpen(false);
    setNotices([]);
  }, []);

  const applyBootstrap = useCallback((next: BootstrapDto, requestedMode?: MapLevel) => {
    if (eventCountryRef.current !== next.country.id) {
      eventCountryRef.current = next.country.id;
      lastWorldEventIdRef.current = next.eventCursor;
      setAtlasEvents([]);
      setNotices([]);
    }
    setBootstrap(next);
    setFocusCity(next.initialCity);
    setPreparedCityScene(null);
    setHoveredAtlasCity(null);
    setMapMode(requestedMode ?? (next.stats.cities > 1 ? "COUNTRY" : "CITY"));
    setSelectedTask(null);
    setRevision((value) => value + 1);
    setCountryMenuOpen(false);
  }, []);

  const load = useCallback(async () => {
    setSessionState((current) => current === "AUTHENTICATED" ? current : "INITIALIZING");
    try {
      const next = await api<BootstrapDto>("/api/bootstrap");
      const countryChanged = eventCountryRef.current !== next.country.id;
      if (countryChanged) {
        eventCountryRef.current = next.country.id;
        lastWorldEventIdRef.current = next.eventCursor;
        setAtlasEvents([]);
        setNotices([]);
      }
      setBootstrap(next);
      setFocusCity((current) => current ?? next.initialCity);
      if (countryChanged) setMapMode(next.stats.cities > 1 ? "COUNTRY" : "CITY");
      setSessionState("AUTHENTICATED");
      setAuthError("");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setBootstrap(null);
        setSessionState("ANONYMOUS");
        setAuthError("");
        setNotices([]);
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

  const openBuilding = useCallback((target: BuildingNavigationTarget) => {
    const focus = () => {
      setFocusTask({ origin: target.origin, token: Date.now() });
      setSelectedTask(target.id);
    };
    if (mapMode === "CITY" && focusCity?.id === target.city.id) { focus(); return; }
    void transitionMap("CITY", { x: .5, y: .5 }, async (signal) => {
      const scene = await api<CitySceneDto>(`/api/cities/${target.city.id}/scene`, {
        signal,
        cache: "no-cache",
        headers: { accept: "application/vnd.tasktopia.city-scene+json; version=2" },
      });
      if (signal.aborted) return;
      const ready = new Promise<void>((resolve) => { cityReadyResolverRef.current = resolve; });
      setPreparedCityScene(scene);
      setFocusCity(target.city);
      setHoveredAtlasCity(null);
      setMapMode("CITY");
      focus();
      await Promise.race([ready, new Promise<void>((resolve) => window.setTimeout(resolve, 12_000))]);
      cityReadyResolverRef.current = null;
    });
  }, [focusCity?.id, mapMode, transitionMap]);

  const openTaskFromSearch = useCallback((result: TaskSearchResultDto) => {
    openBuilding({
      id: result.id,
      origin: result.origin,
      city: { id: result.cityId, name: result.cityName, center: result.cityCenter, bounds: result.cityBounds },
    });
  }, [openBuilding]);

  useEffect(() => { void load().catch(() => undefined); }, [load]);
  useEffect(() => () => {
    mapTransitionAbortRef.current?.abort();
    if (mapTransitionTimerRef.current) clearTimeout(mapTransitionTimerRef.current);
  }, []);
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
        openTaskFromSearch(result);
      })
      .catch(() => undefined);
  }, [bootstrap, openTaskFromSearch]);
  const applyRealtimeEvent = useCallback((event: RealtimeEvent) => {
    if (event.countryId !== countryId || event.id <= lastWorldEventIdRef.current) return;
    lastWorldEventIdRef.current = event.id;
    setMapInvalidation(eventInvalidation(event));
    setAtlasEvents((current) => enqueueCountryAtlasEvent(current, event));
    if (countryAtlasEventImpact(event) === "STRUCTURE") setPlanetRevision((value) => value + 1);
    const notice = presentRealtimeNotice(event);
    if (notice) {
      setNotices((current) => [...current.filter((item) => item.id !== notice.id), notice].slice(-3));
      window.setTimeout(() => setNotices((current) => current.filter((item) => item.id !== notice.id)), notice.tone === "success" ? 10_000 : 7_000);
      if (notice.tone === "success") playCompletionChime();
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
  const effectiveMapMode = mapMode;
  const headerCity = effectiveMapMode === "COUNTRY" ? hoveredAtlasCity : effectiveMapMode === "CITY" ? activeCity : null;
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
        <nav className="flex items-center justify-end gap-1.5" aria-label="Действия карты">
          {effectiveMapMode === "CITY" && <Button className={cx("header-control min-h-0 px-3 text-xs", showDistricts && "!border-skyline !bg-[#1a3942] !text-white")} aria-pressed={showDistricts} onClick={() => setShowDistricts((value) => !value)}>Границы</Button>}
          <ProfilePresence initial={bootstrap.user.name.slice(0, 1).toUpperCase()} online={online} onOpen={() => openSettings("account")} />
        </nav>
      </div>
    </header>

    <section className="map-region">
      <Suspense fallback={<div className="app-loading" role="status"><div className="loader-square" /><span>Загружаем карту…</span></div>}>
          {effectiveMapMode === "PLANET"
            ? <PlanetAtlasCanvas
                userId={bootstrap.user.id}
                activeCountryId={bootstrap.country.id}
                refreshToken={planetRevision}
                onCountrySelect={async (selectedCountryId, focus = { x: .5, y: .5 }) => {
                  await transitionMap("COUNTRY", focus, async () => {
                    const next = await api<BootstrapDto>(`/api/countries/${selectedCountryId}/select`, { method: "POST" });
                    applyBootstrap(next, "COUNTRY");
                  });
                }}
              />
            : effectiveMapMode === "COUNTRY" && bootstrap.stats.cities > 0
              ? <CountryOverviewCanvas
                key={bootstrap.country.id}
                countryId={bootstrap.country.id}
                activeCityId={activeCity?.id}
                events={atlasEvents}
                onEventsProcessed={acknowledgeAtlasEvents}
                onCitySelect={(city, focus = { x: .5, y: .5 }, sourcePoint = city.sourceCenter) => {
                  void transitionMap("CITY", focus, async (signal) => {
                    const scene = await api<CitySceneDto>(`/api/cities/${city.id}/scene`, {
                      signal,
                      cache: "no-cache",
                      headers: { accept: "application/vnd.tasktopia.city-scene+json; version=2" },
                    });
                    if (signal.aborted) return;
                    const ready = new Promise<void>((resolve) => { cityReadyResolverRef.current = resolve; });
                    setPreparedCityScene(scene);
                    setFocusCity({ id: city.id, name: city.name, center: sourcePoint, bounds: city.sourceBounds });
                    setHoveredAtlasCity(null);
                    setMapMode("CITY");
                    // Keep the cover in place until the city renderer has
                    // painted its deterministic seed frame. The bounded
                    // fallback exposes the normal recoverable loader if the
                    // renderer itself cannot initialise.
                    await Promise.race([ready, new Promise<void>((resolve) => window.setTimeout(resolve, 12_000))]);
                    cityReadyResolverRef.current = null;
                  });
                }}
                onCityHover={hoverAtlasCity}
                onZoomOut={() => { void transitionMap("PLANET", { x: .5, y: .5 }, () => { setPreparedCityScene(null); setMapMode("PLANET"); }); }}
              />
              : effectiveMapMode === "CITY" && bootstrap.stats.cities > 0
                ? <WorldCanvas key={`${bootstrap.country.id}:${activeCity?.id ?? "world"}`} countryId={bootstrap.country.id} chunkSize={bootstrap.chunkSize} worldManifest={bootstrap.worldManifest} viewBounds={activeCity?.bounds ?? bootstrap.viewBounds} focusCity={activeCity} initialCityScene={preparedCityScene && preparedCityScene.city.id === activeCity?.id ? preparedCityScene : undefined} focusTask={focusTask} invalidation={mapInvalidation} showDistricts={showDistricts} onTaskSelect={setSelectedTask} onArchiveSelect={openArchive} onReady={() => {
                  cityReadyResolverRef.current?.();
                  cityReadyResolverRef.current = null;
                }} onFatalError={(message) => {
                  if (!preparedCityScene) return;
                  mapTransitionAbortRef.current?.abort();
                  setMapTransition(null);
                  cityReadyResolverRef.current?.();
                  cityReadyResolverRef.current = null;
                  setPreparedCityScene(null);
                  setMapMode("COUNTRY");
                  setMapTransitionError(message);
                }} onZoomOutToCountry={() => { void transitionMap("COUNTRY", { x: .5, y: .5 }, () => { setPreparedCityScene(null); setMapMode("COUNTRY"); }); }} />
                : <div className="world-empty"><div className="empty-square" aria-hidden="true">＋</div><h2>В стране пока нет городов</h2><p>Создайте первый город через MCP — он сразу появится на карте страны и планеты.</p><button className="primary-button" onClick={() => openSettings("mcp")}>Подключить MCP</button></div>}
      </Suspense>
      <MapLevelNav level={effectiveMapMode} hasCity={Boolean(activeCity)} onChange={(nextLevel) => {
        setHoveredAtlasCity(null);
        if (nextLevel === "CITY" && effectiveMapMode !== "CITY") return;
        void transitionMap(nextLevel, { x: .5, y: .5 }, () => {
          setPreparedCityScene(null);
          setMapMode(nextLevel);
        });
      }} />
      {mapTransition && <MapLevelTransition transition={mapTransition} />}
      {mapTransitionError && !mapTransition && <div className="map-transition-error" role="alert"><span>{mapTransitionError}</span><button type="button" onClick={() => setMapTransitionError("")}>Закрыть</button></div>}
      {planOpen && <PlanDrawer bootstrap={bootstrap} refreshToken={revision} initialSection={planSection} onClose={() => setPlanOpen(false)} onCityFocus={(city) => {
        setPlanOpen(false);
        void transitionMap("CITY", { x: .5, y: .5 }, async (signal) => {
          const scene = await api<CitySceneDto>(`/api/cities/${city.id}/scene`, {
            signal,
            cache: "no-cache",
            headers: { accept: "application/vnd.tasktopia.city-scene+json; version=2" },
          });
          if (signal.aborted) return;
          const ready = new Promise<void>((resolve) => { cityReadyResolverRef.current = resolve; });
          setPreparedCityScene(scene);
          setFocusCity(city);
          setMapMode("CITY");
          await Promise.race([ready, new Promise<void>((resolve) => window.setTimeout(resolve, 12_000))]);
          cityReadyResolverRef.current = null;
        });
      }} onTaskSelect={setSelectedTask} onArchiveRecordSelect={setSelectedArchiveRecord} onMutation={refreshWorld} />}
    </section>

    {selectedTask && <Suspense fallback={null}><TaskModal taskId={selectedTask} revision={revision} onClose={closeTask} /></Suspense>}
    {selectedArchiveRecord && <Suspense fallback={null}><ArchiveRecordModal recordId={selectedArchiveRecord} onClose={closeArchiveRecord} /></Suspense>}
    {countryDialog && <CountryPanel bootstrap={bootstrap} mode={countryDialog} onClose={() => setCountryDialog(null)} onBootstrap={applyBootstrap} />}
    {tokensOpen && <Suspense fallback={null}><TokenPanel bootstrap={bootstrap} initialSection={settingsSection} onClose={closeSettings} onAccountChanged={load} onLogout={logout} /></Suspense>}
    <aside className="realtime-notices" aria-live="polite" aria-label="События страны">
      {notices.map((notice) => <article key={notice.id} className={`realtime-notice realtime-notice-${notice.tone}`}>
        <button className="realtime-notice-content" type="button" disabled={!notice.target} onClick={() => {
          if (!notice.target) return;
          openBuilding(notice.target);
          setNotices((current) => current.filter((item) => item.id !== notice.id));
        }}>
          <strong>{notice.title}</strong>
          <small>{notice.location}</small>
          {notice.actionLabel && <span>{notice.actionLabel} →</span>}
        </button>
        <button className="realtime-notice-close" type="button" aria-label="Закрыть уведомление" onClick={() => setNotices((current) => current.filter((item) => item.id !== notice.id))}>×</button>
      </article>)}
    </aside>
  </main>;
}
