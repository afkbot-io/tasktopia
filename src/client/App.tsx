import { countrySelectionPending, invalidateCountrySelections, selectCountrySession } from "./country-selection";
import { useDialogFocus } from "./use-dialog-focus";
import { WorldDigest } from "./components/WorldDigest";
import { MapDependencies } from "./components/MapDependencies";
import type { MapDependencySelection } from "./map-dependencies";
import { MapAttention } from "./components/MapAttention";
import { MapLegend } from "./components/MapLegend";
import { DistrictPlans } from "./components/DistrictPlans";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { BootstrapDto, BuildingEventContext, CityDto, RealtimeEvent, TaskSearchResultDto, TaskResolutionDto, WorldFeatureDto } from "../shared/contracts";
import type { PlanetViewState } from "./components/PlanetAtlasCanvas";
import type { CitySceneDto } from "../shared/city-scene-contract";
import { countryOverviewEventImpact } from "../shared/country-overview-events";
import { presentRealtimeNotice, type RealtimeNoticePresentation } from "../shared/realtime-notifications";
import { api, ApiError } from "./api";
import { AuthScreen } from "./components/AuthScreen";
import { CountryPanel } from "./components/CountryPanel";
import { CountrySwitcher } from "./components/CountrySwitcher";
import { CityDirectory } from "./components/CityDirectory";
import { TaskSearch } from "./components/TaskSearch";
import { GamePopover } from "./components/GamePopover";
import { MapLevelNav, type MapLevel } from "./components/MapLevelNav";
import { MapLevelTransition } from "./components/MapLevelTransition";
import { ProfilePresence } from "./components/ProfilePresence";
import { createAtlasTransition, withAtlasTransitionPhase, type AtlasTransition } from "./atlas-navigation-transition";
import { createAtlasWheelNavigation } from "./atlas-zoom-navigation";
import { acknowledgeMapInvalidations, enqueueMapInvalidation, eventInvalidation, type MapInvalidation } from "./map-invalidation";
import { clearPushSubscriptionForLogout } from "./push-notifications";
import { PushNotificationCard } from "./components/PushNotificationCard";
import { SiteHistoryModal } from "./components/SiteHistoryModal";
import { advanceMapSceneCaches, clearMapSceneCaches, invalidateTransportSceneCaches, loadCityScene, rememberCountryRevision } from "./map-scene-cache";
import { clearTaskDetailCache, invalidateTaskDetails } from "./task-detail-cache";
import { taskResolutionQuery } from "./task-navigation";
import { clearPlanetAtlasCache } from "./planet-atlas-cache";
import { CoalescedRefresh } from "./coalesced-refresh";
import { WorldPreferences } from "./components/WorldPreferences";
import { WorldAmbientLighting } from "./components/WorldAmbientLighting";

const loadWorldRenderer = () => import("./components/WorldCanvas").then(module => ({ default: module.WorldCanvas }));
const WorldCanvas = lazy(loadWorldRenderer);
const PlanetAtlasCanvas = lazy(() => import("./components/PlanetAtlasCanvas").then((module) => ({ default: module.PlanetAtlasCanvas })));
const CityDevelopmentPanel = lazy(() => import("./components/CityDevelopmentPanel").then(module => ({ default: module.CityDevelopmentPanel })));
const TaskModal = lazy(() => import("./components/TaskModal").then((module) => ({ default: module.TaskModal })));
const ArchiveRecordModal = lazy(() => import("./components/ArchiveRecordModal").then((module) => ({ default: module.ArchiveRecordModal })));
const TokenPanel = lazy(() => import("./components/TokenPanel").then((module) => ({ default: module.TokenPanel })));

type SessionState = "INITIALIZING" | "ANONYMOUS" | "AUTHENTICATED" | "RECOVERABLE_ERROR";
type CityFocus = Pick<CityDto, "id" | "name" | "center" | "bounds">;
type BuildingNavigationTarget = Pick<BuildingEventContext, "id" | "origin" | "city">;

function TaskModalFallback({ onClose, standalone = false, error, onRetry }: { onClose: () => void; standalone?: boolean; error?: string; onRetry?: () => void }) {
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus(dialogRef);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return <div className={`modal-backdrop task-inspector-backdrop${standalone ? " task-entry-backdrop" : ""}`} role="presentation">
    <section ref={dialogRef} className="task-modal task-inspector" role="dialog" aria-modal="true" aria-label={error ? "Задача недоступна" : "Загрузка задачи"}>
      <button className="modal-close" aria-label="Закрыть" onClick={onClose}>×</button>
      <div className="task-load-state" role={error ? "alert" : "status"}>
        <strong>{error ? "Не удалось открыть задачу" : "Открываем задачу…"}</strong>
        {error && <><p>{error}</p><button className="primary-button" onClick={onRetry}>Повторить</button><button onClick={onClose}>К планете</button></>}
      </div>
    </section>
  </div>;
}

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
  const [wheelNavigation] = useState(createAtlasWheelNavigation);
  const [bootstrap, setBootstrap] = useState<BootstrapDto | null>(null);
  const [retainedCityKey,setRetainedCityKey]=useState<string|null>(null);
  const [sessionState, setSessionState] = useState<SessionState>("INITIALIZING");
  const [authError, setAuthError] = useState("");
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [selectedSite, setSelectedSite] = useState<{ countryId: string; feature: WorldFeatureDto } | null>(null);
  const selectedTaskRef = useRef(selectedTask);
  useEffect(() => { selectedTaskRef.current = selectedTask; }, [selectedTask]);
  const [taskRevision, setTaskRevision] = useState(0);
  const [bootstrapRefresh, setBootstrapRefresh] = useState(0);
  const sessionGenerationRef = useRef(0);
  const authenticationEpochRef=useRef(0);
  const bootstrapLoadRef = useRef(new CoalescedRefresh());
  const [selectedArchiveRecord, setSelectedArchiveRecord] = useState<string | null>(null);
  const [tokensOpen, setTokensOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<"mcp" | "account">("mcp");
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [directoryFocus, setDirectoryFocus] = useState<{ cityId: string; districtId: string }>();
  const [directorySection, setDirectorySection] = useState<"cities" | "archive">("cities");
  const [countryMenuOpen, setCountryMenuOpen] = useState(false);
  const [countryDialog, setCountryDialog] = useState<"manage" | "create" | null>(null);
  const [showDistricts, setShowDistricts] = useState(false);
  const [mapMode, setMapMode] = useState<MapLevel>("PLANET");
  const [mapTransition, setMapTransition] = useState<AtlasTransition | null>(null);
  const mapTransitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapTransitionAbortRef = useRef<AbortController | null>(null);
  const [focusCity, setFocusCity] = useState<CityFocus | null>(null);
  const [preparedCityScene, setPreparedCityScene] = useState<CitySceneDto | null>(null);
  const [planetEntryCountryId, setPlanetEntryCountryId] = useState<string | null>(null);
  const [planetViewMemory] = useState(() => new Map<string, PlanetViewState>());
  const rememberPlanetView = useCallback((view: PlanetViewState) => { planetViewMemory.set("last", view); }, [planetViewMemory]);
  const [focusTask, setFocusTask] = useState<{ origin: { x: number; y: number }; token: number } | null>(null);
  const deepLinkHandledRef = useRef(false);
  // Decide before the first bootstrap render: no map module, asset or scene
  // competes with an incoming task card for network or the main thread.
  const [taskEntry, setTaskEntry] = useState(() => taskResolutionQuery(new URL(window.location.href)));
  const taskEntryRequestRef = useRef(0);
  const eventCountryRef = useRef<string | undefined>(undefined);
  const lastWorldEventIdRef = useRef(0);
  const [revision, setRevision] = useState(0);
  const [planetRevision, setPlanetRevision] = useState(0);
  const [transportRevision,setTransportRevision]=useState(0);
  const [attention, setAttention] = useState<{ scope: string; ids: string[]; label?:string }>({ scope: "", ids: [] });
  const [dependencyTask, setDependencyTask] = useState<{ scope: string; id: string }>();
  const [dependencyData, setDependencyData] = useState<{ scope: string; selection?: MapDependencySelection }>({ scope: "" });
  const [developmentOpen, setDevelopmentOpen] = useState(false);
  const closeDevelopment = useCallback(() => setDevelopmentOpen(false), []);
  const [attentionRevision, setAttentionRevision] = useState(0);
  useEffect(() => { if (selectedTask) { setDependencyTask(undefined); setDependencyData({ scope: "" }); } }, [selectedTask]);
  const [mapInvalidations, setMapInvalidations] = useState<MapInvalidation[]>([]);
  const acknowledgeCityInvalidations = useCallback((cursor: number) => {
    setMapInvalidations(current => acknowledgeMapInvalidations(current, cursor));
  }, []);
  const [online, setOnline] = useState(true);
  const [notices, setNotices] = useState<RealtimeNoticePresentation[]>([]);
  const [mapTransitionError, setMapTransitionError] = useState("");
  const [pushOfferDismissed, setPushOfferDismissed] = useState(() => localStorage.getItem("tasktopia:push-offer-dismissed") === "1");
  const cityReadyResolverRef = useRef<(() => void) | null>(null);
  const countryId = bootstrap?.country.id;
  useEffect(() => { setSelectedSite(null); setDirectoryFocus(undefined); }, [countryId, sessionState]);
  const closeSite = useCallback(() => setSelectedSite(null), []);
  const closeTask = useCallback(() => {
    setSelectedTask(null);
    if (taskEntry) {
      taskEntryRequestRef.current++;
      setTaskEntry(null);
      setMapTransitionError("");
      window.history.replaceState(null, "", "/");
      setMapMode(selectedTask && focusCity ? "CITY" : "PLANET");
    }
  }, [taskEntry, selectedTask, focusCity]);
  const closeArchiveRecord = useCallback(() => setSelectedArchiveRecord(null), []);
  const closeSettings = useCallback(() => setTokensOpen(false), []);
  const openSettings = useCallback((section: "mcp" | "account") => {
    setSettingsSection(section);
    setTokensOpen(true);
  }, []);
  const openArchive = useCallback(() => {
    setDirectorySection("archive");
    setDirectoryOpen(true);
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
        }, 0);
      }
    }
  }, [mapMode]);
  const logout = useCallback(async () => {
    authenticationEpochRef.current++;
    invalidateCountrySelections();
    sessionGenerationRef.current += 1;
    mapTransitionAbortRef.current?.abort();
    setMapTransition(null);
    clearMapSceneCaches();
    clearTaskDetailCache();
    clearPlanetAtlasCache();
    await clearPushSubscriptionForLogout();
    await api("/api/auth/logout", { method: "POST" });
    setBootstrap(null);
    setFocusCity(null);
    setFocusTask(null);
    setPreparedCityScene(null);
    setRetainedCityKey(null);
    setSelectedTask(null);
    setSessionState("ANONYMOUS");
    setAuthError("");
    planetViewMemory.clear();
    setTokensOpen(false);
    setNotices([]);
  }, [planetViewMemory]);

  const renderedAuthenticationEpoch = authenticationEpochRef.current;
  const applyBootstrap = useCallback((next: BootstrapDto, requestedMode?: MapLevel, preserveTransition = false) => {
    sessionGenerationRef.current += 1;
    if (!preserveTransition) { mapTransitionAbortRef.current?.abort(); setMapTransition(null); }
    setPlanetRevision(value => value + 1);
    if (eventCountryRef.current !== next.country.id) {
      clearMapSceneCaches();
      clearTaskDetailCache();
      setMapInvalidations([]);
      eventCountryRef.current = next.country.id;
      lastWorldEventIdRef.current = next.eventCursor;
      setNotices([]);
    }
    rememberCountryRevision(next.country.id, next.country.worldVersion);
    setBootstrap(next);
    setFocusCity(next.initialCity);
    setFocusTask(null);
    setPreparedCityScene(null);
    setRetainedCityKey(null);
    setMapMode(requestedMode ?? "PLANET");
    setSelectedTask(null);
    setRevision((value) => value + 1);
    setCountryMenuOpen(false);
    setDirectoryOpen(false);
    setDirectoryFocus(undefined);
    setDevelopmentOpen(false);
  }, []);

  const load = useCallback(() => bootstrapLoadRef.current.request(async () => {
    const generation = sessionGenerationRef.current;
    setSessionState((current) => current === "AUTHENTICATED" ? current : "INITIALIZING");
    try {
      const next = await api<BootstrapDto>("/api/bootstrap");
      if (generation !== sessionGenerationRef.current) return;
      const countryChanged = eventCountryRef.current !== next.country.id;
      if (countryChanged) {
        clearMapSceneCaches();
        clearTaskDetailCache();
        setMapInvalidations([]);
        setFocusTask(null);
        eventCountryRef.current = next.country.id;
        lastWorldEventIdRef.current = next.eventCursor;
          setNotices([]);
      }
      rememberCountryRevision(next.country.id, next.country.worldVersion);
      setBootstrap(current => current?.country.id === next.country.id ? {
        ...next, country: { ...next.country, worldVersion: Math.max(next.country.worldVersion, current.country.worldVersion) },
        eventCursor: Math.max(next.eventCursor, current.eventCursor),
      } : next);
      setFocusCity((current) => current ?? next.initialCity);
      if (countryChanged) setMapMode("PLANET");
      setSessionState("AUTHENTICATED");
      setAuthError("");
    } catch (error) {
      if (generation !== sessionGenerationRef.current) return;
      if (error instanceof ApiError && error.status === 401) {
        authenticationEpochRef.current++;
        invalidateCountrySelections();
        clearMapSceneCaches();
        clearTaskDetailCache();
        clearPlanetAtlasCache();
        setBootstrap(null);
        setSelectedTask(null);
        deepLinkHandledRef.current = false;
        taskEntryRequestRef.current++;
        setSessionState("ANONYMOUS");
        setAuthError("");
        setNotices([]);
        return;
      }
      setAuthError(error instanceof Error ? error.message : "Не удалось загрузить страну");
      setSessionState((current) => current === "AUTHENTICATED" ? current : "RECOVERABLE_ERROR");
      throw error;
    }
  }), []);
  const refreshWorld = useCallback(async () => {
    applyBootstrap(await api<BootstrapDto>("/api/bootstrap"));
  }, [applyBootstrap]);

  const openBuilding = useCallback((target: BuildingNavigationTarget, session = bootstrap) => {
    const focus = () => {
      setFocusTask({ origin: target.origin, token: Date.now() });
      setSelectedTask(target.id);
    };
    // The card is independent of terrain preparation, even on direct links.
    focus();
    if (session?.country.id === countryId && mapMode === "CITY" && focusCity?.id === target.city.id) return;
    void transitionMap("CITY", { x: .5, y: .5 }, async (signal) => {
      if (!session) throw new Error("Страна не выбрана");
      const scene = await loadCityScene(session.country.id, target.city.id, session.country.worldVersion);
      if (signal.aborted) return;
      const ready = new Promise<void>((resolve) => { cityReadyResolverRef.current = resolve; });
      setPreparedCityScene(scene);
      setFocusCity(target.city);
        setMapMode("CITY");
      await Promise.race([ready, new Promise<void>((resolve) => window.setTimeout(resolve, 12_000))]);
      cityReadyResolverRef.current = null;
    });
  }, [bootstrap, countryId, focusCity?.id, mapMode, transitionMap]);

  const openTaskFromSearch = useCallback((result: TaskSearchResultDto) => {
    openBuilding({
      id: result.id,
      origin: result.origin,
      city: { id: result.cityId, name: result.cityName, center: result.cityCenter, bounds: result.cityBounds },
    });
  }, [openBuilding]);

  const openCanonicalTask = useCallback(async (query: string, entryOnly = false) => {
    const generation = sessionGenerationRef.current;
    const epoch = authenticationEpochRef.current;
    const request = entryOnly ? ++taskEntryRequestRef.current : 0;
    const entryCancelled = () => entryOnly && request !== taskEntryRequestRef.current;
    setMapTransitionError("");
    try {
      const resolved = await api<TaskResolutionDto>(`/api/tasks/resolve?${query}`);
      if (generation !== sessionGenerationRef.current || epoch !== authenticationEpochRef.current || entryCancelled()) return;
      let session = bootstrap;
      if (resolved.countryId !== countryId || countrySelectionPending()) {
        session = await selectCountrySession(resolved.countryId);
        if (epoch !== authenticationEpochRef.current) return;
        // Reflect the confirmed session even if the user cancelled the link
        // while selection was in flight. Never resurrect the cancelled card.
        applyBootstrap(session, entryOnly ? "PLANET" : "CITY");
        if (entryCancelled()) return;
      }
      const target = { id: resolved.id, origin: resolved.origin,
        city: { id: resolved.cityId, name: resolved.cityName, center: resolved.cityCenter, bounds: resolved.cityBounds } };
      if (entryOnly) {
        setFocusCity(target.city);
        setFocusTask({ origin: target.origin, token: Date.now() });
        setSelectedTask(target.id);
      } else openBuilding(target, session);
    } catch (error) {
      if (epoch !== authenticationEpochRef.current || entryCancelled()) return;
      if (error instanceof ApiError && error.status === 401) { void load().catch(() => undefined); return; }
      setMapTransitionError(error instanceof Error ? error.message : "Не удалось открыть задачу");
    }
  }, [bootstrap, countryId, applyBootstrap, openBuilding, load]);

  useEffect(() => { void load().catch(() => undefined); }, [load]);
  useEffect(() => {
    if (countryId || taskEntry) void import("./components/TaskModal");
    if (countryId && !taskEntry) void import("./components/PlanetAtlasCanvas");
  }, [countryId, taskEntry]);
  const cityPrefetchPendingRef=useRef(false);
  const prepareCityIntent = useCallback((countryId: string, cityId: string, revision: number) => {
    void loadWorldRenderer();
    if(cityPrefetchPendingRef.current)return;
    cityPrefetchPendingRef.current=true;
    void loadCityScene(countryId, cityId, revision).catch(() => undefined).finally(()=>{cityPrefetchPendingRef.current=false;});
  }, []);

  const openPlanetCity = useCallback(async (selectedCountryId: string, cityId: string, focus = {x:.5,y:.5}) => {
    if (!bootstrap) return;
    const authenticationEpoch=authenticationEpochRef.current;
    await transitionMap("CITY", focus, async signal => {
      void loadWorldRenderer();
      let session=bootstrap;
      if (selectedCountryId !== bootstrap.country.id || countrySelectionPending()) {
        session=await selectCountrySession(selectedCountryId);
        if(authenticationEpoch!==authenticationEpochRef.current)return;
        // Even a cancelled camera flight must reflect the confirmed session.
        // A later queued selection will publish its own result in order.
        applyBootstrap(session,"PLANET",true);
        if (signal.aborted) return;
      }
      const scene=await loadCityScene(selectedCountryId,cityId,session.country.worldVersion);
      if(signal.aborted) return;
      performance.mark('tasktopia:city-data-ready');
      const ready = new Promise<void>(resolve => {cityReadyResolverRef.current=resolve;});
      setPreparedCityScene(scene);
      setFocusCity(scene.city);
      setFocusTask(null);
      setShowDistricts(false);
      setMapMode("CITY");
      await Promise.race([ready,new Promise<void>(resolve=>window.setTimeout(resolve,12_000))]);
      if(!signal.aborted) cityReadyResolverRef.current=null;
    });
  }, [bootstrap,applyBootstrap,transitionMap]);
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
    // Deep links are a one-shot bootstrap concern. Mark the initial location
    // handled even when it is `/`, otherwise a task URL written by TaskModal
    // can be mistaken for a new incoming link and reopen after the user closes it.
    deepLinkHandledRef.current = true;
    const query = taskEntry ?? taskResolutionQuery(new URL(window.location.href));
    if (query) void openCanonicalTask(query, true);
  }, [bootstrap, openCanonicalTask, taskEntry]);
  const applyRealtimeEvent = useCallback((event: RealtimeEvent) => {
    if (event.countryId !== countryId || event.id <= lastWorldEventIdRef.current) return;
    if (!event.type.startsWith("task.comment") && (event.type.startsWith("task.") || event.type.startsWith("district.") || event.type === "country.regenerated")) setAttentionRevision(value => value + 1);
    advanceMapSceneCaches(event);
    const affectedTask = invalidateTaskDetails(event);
    if (affectedTask === null || affectedTask === selectedTaskRef.current) setTaskRevision(value => value + 1);
    lastWorldEventIdRef.current = event.id;
    setMapInvalidations(current => enqueueMapInvalidation(current, eventInvalidation(event)));
    if (countryOverviewEventImpact(event) !== "NONE") setPlanetRevision((value) => value + 1);
    const notice = presentRealtimeNotice(event);
    if (notice) {
      setNotices((current) => [...current.filter((item) => item.id !== notice.id), notice].slice(-3));
      window.setTimeout(() => setNotices((current) => current.filter((item) => item.id !== notice.id)), notice.tone === "success" ? 10_000 : 7_000);
      if (notice.tone === "success") playCompletionChime();
    }
    setBootstrap((current) => current
        ? { ...current, country: { ...current.country, worldVersion: event.worldVersion }, eventCursor: event.id }
        : current);
    setRevision((value) => value + 1);
    if (countryOverviewEventImpact(event) === "STRUCTURE" || event.type === "country.profile_updated") setBootstrapRefresh(value => value + 1);
  }, [countryId]);
  useEffect(() => {
    if (bootstrapRefresh === 0) return;
    // Replay bursts commit together; one bootstrap refresh owns the batch.
    void load().catch(() => setOnline(false));
  }, [bootstrapRefresh, load]);
  const invalidateForeignTransport = useCallback(() => {
    invalidateTransportSceneCaches();
    setPreparedCityScene(null);
    setRetainedCityKey(null);
    setTransportRevision(value=>value+1);
    setPlanetRevision(value=>value+1);
    setAttentionRevision(value=>value+1);
  }, []);
  useEffect(() => {
    if (!countryId) return;
    let active = true;
    let disconnect: (() => void) | undefined;
    void import("socket.io-client").then(({ io }) => {
      if (!active) return;
      const socket = io({ path: "/socket.io", withCredentials: true });
      disconnect = () => socket.disconnect();
      let replaying = true;
      let connectedOnce = false;
      let buffered: RealtimeEvent[] = [];
      const receive = (event: RealtimeEvent) => {
        if (event.countryId !== countryId) return;
        if (replaying) buffered.push(event);
        else applyRealtimeEvent(event);
      };
      socket.on("connect", () => {
        // The initial country bootstrap already clears scene caches. Only a
        // reconnect can have missed foreign transport events while offline.
        if (connectedOnce) invalidateForeignTransport();
        connectedOnce = true;
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
      socket.on("atlas:invalidate", invalidateForeignTransport);
    });
    return () => { active = false; disconnect?.(); };
  }, [applyRealtimeEvent, countryId, invalidateForeignTransport]);

  if (sessionState === "INITIALIZING" && !bootstrap) return <div className="app-loading" role="status"><div className="loader-square" /><span>{taskEntry ? "Открываем задачу…" : "Открываем мир…"}</span></div>;
  if (sessionState === "ANONYMOUS" || sessionState === "RECOVERABLE_ERROR" || !bootstrap) {
    return <AuthScreen initialError={sessionState === "RECOVERABLE_ERROR" ? authError : ""} onAuthenticated={load} />;
  }

  const activeCity = focusCity ?? bootstrap.initialCity;
  const dependencyScope = `${bootstrap.user.id}:${countryId}:${activeCity?.id}`;
  if (taskEntry) return <main className="task-entry" aria-label="Карточка задачи">
    {selectedTask ? <Suspense fallback={<TaskModalFallback standalone onClose={closeTask} />}>
      <TaskModal onAuthenticationRequired={load} standalone key={`${countryId}:${selectedTask}`} countryId={bootstrap.country.id} taskId={selectedTask} revision={taskRevision}
        canEdit={bootstrap.countryRole !== "VIEWER"} onTransferred={task => setFocusTask({ origin: task.origin, token: Date.now() })}
        onShowDependencies={id => { setDependencyData({ scope: "" }); setDependencyTask({ scope: dependencyScope, id }); closeTask(); }} onClose={closeTask} />
    </Suspense> : <TaskModalFallback standalone onClose={closeTask} error={mapTransitionError} onRetry={() => { void openCanonicalTask(taskEntry, true); }} />}
  </main>;
  const effectiveMapMode = mapMode;
  const headerCity = effectiveMapMode === "CITY" ? activeCity : null;
  return <main className="app-shell grid h-full grid-rows-[auto_minmax(0,1fr)] bg-[#081316]">
    <header className="app-header map-toolbar" aria-label="Управление миром" onClickCapture={event => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const trigger = target.closest('button, summary');
      if (!trigger || trigger.closest('.game-popover-panel, .map-legend-panel, .country-switcher, .task-search-results')) return;
      for (const panel of event.currentTarget.querySelectorAll<HTMLDetailsElement>('details[open]')) {
        if (!panel.contains(trigger)) panel.open = false;
      }
      if (!trigger.closest('.country-title-button')) setCountryMenuOpen(false);
      if (!trigger.closest('.header-city')) setDirectoryOpen(false);
      setDevelopmentOpen(false);
    }}>
      <div className="map-toolbar-location">
        <div className="brand-mark hidden shrink-0 xl:flex"><span>▦</span> TASKTOPIA</div>
        <div className="relative min-w-0">
        <button className="country-title-button grid min-w-0 border-0 border-l-0 px-0 text-left xl:border-l xl:border-[#304850] xl:pl-5" aria-haspopup="dialog" aria-expanded={countryMenuOpen} onClick={() => { setDirectoryOpen(false); setCountryMenuOpen((value) => !value); }}>
          <span className="text-[9px] font-black tracking-[.16em] text-[#81979b]">МИР</span>
          <strong className="block max-w-[180px] truncate text-sm text-[#edf0e7] md:max-w-[240px]">{bootstrap.country.name}</strong>
        </button>
        {countryMenuOpen && <CountrySwitcher bootstrap={bootstrap} onClose={() => setCountryMenuOpen(false)} onBootstrap={next => { if (renderedAuthenticationEpoch === authenticationEpochRef.current) applyBootstrap(next); }} onCities={() => { setCountryMenuOpen(false); setDirectoryFocus(undefined); setDirectorySection("cities"); setDirectoryOpen(true); }} onManage={() => { setCountryMenuOpen(false); setCountryDialog("manage"); }} onCreate={() => { setCountryMenuOpen(false); setCountryDialog("create"); }} />}
        </div>
        {headerCity && <button className="header-city" aria-label={`Районы города ${headerCity.name}`} onClick={() => { setDirectoryFocus({cityId:headerCity.id,districtId:""});setDirectorySection("cities");setDirectoryOpen(value=>!value); }}>
          <span className="text-[9px] font-black tracking-[.16em] text-[#81979b]">ГОРОД</span>
          <strong className="block max-w-[180px] truncate text-sm text-[#edf0e7]">{headerCity.name}<span aria-hidden="true"> ▾</span></strong>
        </button>}
      </div>

      <div className="header-search map-toolbar-search">
        <TaskSearch key={countryId} onSelect={openTaskFromSearch} />
      </div>

      <div className="map-toolbar-actions">
        <nav className="flex items-center justify-end gap-1.5" aria-label="Действия карты">
          <WorldAmbientLighting />
          {effectiveMapMode === "CITY" && activeCity && <GamePopover label="Фильтры" icon="▤" activeLabel={attention.scope===`${bootstrap.user.id}:${countryId}:${activeCity.id}`?attention.label:undefined}>
            <strong>Показать на карте</strong>
            <MapAttention key={`${bootstrap.user.id}:${countryId}:${activeCity.id}`} userId={bootstrap.user.id} countryId={bootstrap.country.id} cityId={activeCity.id} revision={attentionRevision} onChange={setAttention} />
            <button className="city-development-toggle" onClick={() => setDevelopmentOpen(value => !value)} aria-expanded={developmentOpen}>Развитие города</button>
          </GamePopover>}
          <GamePopover label="Меню" icon="≡" className="world-menu">
            <strong>{bootstrap.country.name}</strong>
            <button onClick={() => {setDirectoryOpen(false);setCountryMenuOpen(true);}}>Выбрать мир</button>
            <button onClick={() => { setCountryMenuOpen(false);setDirectoryFocus(undefined);setDirectorySection("cities");setDirectoryOpen(true); }}>Города</button>
            <button onClick={openArchive}>Архив проекта</button>
            <button onClick={() => openSettings("mcp")}>Подключить MCP</button>
            <button onClick={() => openSettings("account")}>Аккаунт и настройки</button>
            <div className="mobile-menu-tools"><WorldPreferences /><MapLegend /></div>
            <button onClick={() => {setCountryMenuOpen(false);setCountryDialog("manage");}}>Управление миром</button>
          </GamePopover>
          <WorldPreferences />
          <MapLegend />
          <WorldDigest key={`${bootstrap.user.id}:${countryId}`} userId={bootstrap.user.id} countryId={bootstrap.country.id} onTask={id => { void openCanonicalTask(new URLSearchParams({ id }).toString()); }} />
          <ProfilePresence initial={bootstrap.user.name.slice(0, 1).toUpperCase()} online={online} onOpen={() => openSettings("account")} />
        </nav>
      </div>
    </header>

    <section className="map-region" onWheelCapture={event => {
      if (event.target instanceof Element && event.target.closest("[data-country-control]")) return;
      wheelNavigation.observe({ at: event.timeStamp, deltaY: event.deltaY });
    }}>
      <Suspense fallback={<div className="app-loading" role="status"><div className="loader-square" /><span>Загружаем карту…</span></div>}>
          {effectiveMapMode === "PLANET" ? <PlanetAtlasCanvas
            wheelNavigation={wheelNavigation} userId={bootstrap.user.id} activeCountryId={bootstrap.country.id}
            initialFocusCountryId={planetEntryCountryId ?? undefined} refreshToken={planetRevision}
            initialView={planetViewMemory.get("last")} onViewChange={rememberPlanetView}
            onCitySelect={openPlanetCity} onCityIntent={prepareCityIntent}
          /> : !activeCity ? <div className="world-empty"><div className="empty-square" aria-hidden="true">＋</div><h2>Пока нет городов</h2><p>Создайте первый город через MCP — он сразу появится на планете.</p><button className="primary-button" onClick={() => openSettings("mcp")}>Подключить MCP</button></div> : null}
      </Suspense>
      {activeCity && (effectiveMapMode === "CITY" || preparedCityScene !== null || retainedCityKey===`${bootstrap.country.id}:${activeCity.id}`) && <div aria-hidden={effectiveMapMode !== "CITY"} style={{ position:"absolute", inset:0, visibility:effectiveMapMode === "CITY" ? "visible" : "hidden", pointerEvents:effectiveMapMode === "CITY" ? "auto" : "none" }}>
        <Suspense fallback={<div className="app-loading" role="status">Готовим город…</div>}>
          <WorldCanvas transportRevision={transportRevision} dependencies={dependencyTask?.scope === dependencyScope && dependencyData.scope === dependencyScope ? dependencyData.selection : undefined} attentionIds={attention.scope === `${bootstrap.user.id}:${countryId}:${activeCity?.id}` ? attention.ids : undefined} onDistrictSelect={districtId => { if (activeCity) setDirectoryFocus({ cityId: activeCity.id, districtId }); setDirectorySection("cities"); setDirectoryOpen(true); }} active={effectiveMapMode === "CITY"} key={`${bootstrap.country.id}:${activeCity?.id ?? "world"}`} countryId={bootstrap.country.id} chunkSize={bootstrap.chunkSize} worldManifest={bootstrap.worldManifest} viewBounds={activeCity?.bounds ?? bootstrap.viewBounds} focusCity={activeCity} initialCityScene={preparedCityScene && preparedCityScene.city.id === activeCity?.id ? preparedCityScene : undefined} startAtMinimumScale={Boolean(preparedCityScene && preparedCityScene.city.id === activeCity?.id)} focusTask={focusTask} invalidations={mapInvalidations} onInvalidationsProcessed={acknowledgeCityInvalidations} showDistricts={showDistricts} onTaskSelect={setSelectedTask} onArchiveSelect={openArchive} onSiteSelect={feature => { setSelectedTask(null); setSelectedSite({ countryId: bootstrap.country.id, feature }); }} onReady={() => {
                  setRetainedCityKey(`${bootstrap.country.id}:${activeCity.id}`);
                  cityReadyResolverRef.current?.();
                  cityReadyResolverRef.current = null;
                  performance.mark("tasktopia:city-first-frame");
                }} wheelNavigation={wheelNavigation} onFatalError={(message) => {
                  if (!preparedCityScene) return;
                  mapTransitionAbortRef.current?.abort();
                  setMapTransition(null);
                  cityReadyResolverRef.current?.();
                  cityReadyResolverRef.current = null;
                  setPreparedCityScene(null);
    setRetainedCityKey(null);
                  setMapMode("PLANET");
                  setMapTransitionError(message);
                }} onZoomOutToPlanet={(focus = { x: .5, y: .5 }) => { void transitionMap("PLANET", focus, () => { setPlanetEntryCountryId(bootstrap.country.id); setMapMode("PLANET"); }); }} />
        </Suspense>
      </div>}
      <MapLevelNav level={effectiveMapMode} hasCity={Boolean(activeCity)} showDistricts={showDistricts} onDistrictsChange={setShowDistricts} onChange={(nextLevel) => {
        if (nextLevel === effectiveMapMode || (nextLevel === "CITY" && !activeCity)) return;
            void transitionMap(nextLevel, { x: .5, y: .5 }, () => {
          if (nextLevel === "PLANET") setPlanetEntryCountryId(bootstrap.country.id);
          setMapMode(nextLevel);
        });
      }} />
      {mapTransition && <MapLevelTransition transition={mapTransition} onCancel={()=>{
        mapTransitionAbortRef.current?.abort();setMapTransition(null);setMapMode('PLANET');
        cityReadyResolverRef.current?.();cityReadyResolverRef.current=null;
      }} />}
      {mapTransitionError && !mapTransition && <div className="map-transition-error" role="alert"><span>{mapTransitionError}</span><button type="button" onClick={() => setMapTransitionError("")}>Закрыть</button></div>}
      {effectiveMapMode === "CITY" && dependencyTask?.scope === dependencyScope && <MapDependencies key={`${dependencyScope}:${dependencyTask.id}`} countryId={bootstrap.country.id} taskId={dependencyTask.id} scope={dependencyScope} revision={attentionRevision} onChange={setDependencyData} onClose={() => { setDependencyTask(undefined); setDependencyData({ scope: "" }); }} />}
      {effectiveMapMode === "CITY" && activeCity && developmentOpen && <Suspense fallback={<div className="city-development-panel" role="status">Загрузка…</div>}><CityDevelopmentPanel key={dependencyScope} countryId={bootstrap.country.id} cityId={activeCity.id} revision={attentionRevision} onClose={closeDevelopment} onTask={id => { closeDevelopment(); setSelectedTask(id); }} /></Suspense>}
      {effectiveMapMode === "CITY" && activeCity && <DistrictPlans key={`${countryId}:${activeCity.id}`} countryId={bootstrap.country.id} cityId={activeCity.id} revision={revision} onSelect={districtId => {
        setDirectoryFocus({ cityId: activeCity.id, districtId }); setDirectorySection("cities"); setDirectoryOpen(true);
      }} />}
      {directoryOpen && <CityDirectory key={`${countryId}:${directoryFocus?.districtId ?? "general"}`} initialFocus={directoryFocus} bootstrap={bootstrap} refreshToken={revision} initialSection={directorySection} onClose={() => setDirectoryOpen(false)} onCityFocus={(city) => {
        setDirectoryOpen(false);
        void transitionMap("CITY", { x: .5, y: .5 }, async (signal) => {
          const scene = await loadCityScene(bootstrap.country.id, city.id, bootstrap.country.worldVersion);
          if (signal.aborted) return;
          const ready = new Promise<void>((resolve) => { cityReadyResolverRef.current = resolve; });
          setPreparedCityScene(scene);
          setFocusCity(city);
          setFocusTask(null);
          setMapMode("CITY");
          await Promise.race([ready, new Promise<void>((resolve) => window.setTimeout(resolve, 12_000))]);
          cityReadyResolverRef.current = null;
        });
      }} onTaskSelect={setSelectedTask} onArchiveRecordSelect={setSelectedArchiveRecord} onMutation={refreshWorld} />}
    </section>

    {selectedTask && <Suspense fallback={<TaskModalFallback onClose={closeTask} />}><TaskModal onAuthenticationRequired={load} key={`${countryId}:${selectedTask}`} countryId={bootstrap.country.id} taskId={selectedTask} revision={taskRevision} onShowDependencies={id => { setDependencyData({ scope: "" }); setDependencyTask({ scope: dependencyScope, id }); closeTask(); }} canEdit={bootstrap.countryRole !== "VIEWER"} onTransferred={task => setFocusTask({ origin: task.origin, token: Date.now() })} onClose={closeTask} /></Suspense>}
    {selectedSite?.countryId === bootstrap.country.id && <SiteHistoryModal feature={selectedSite.feature} onClose={closeSite} onTaskOpen={taskId => {
      closeSite(); void openCanonicalTask(new URLSearchParams({ id: taskId }).toString());
    }} />}
    {selectedArchiveRecord && <Suspense fallback={null}><ArchiveRecordModal recordId={selectedArchiveRecord} onClose={closeArchiveRecord} /></Suspense>}
    {countryDialog && <CountryPanel bootstrap={bootstrap} mode={countryDialog} onClose={() => setCountryDialog(null)} onBootstrap={next => { if (renderedAuthenticationEpoch === authenticationEpochRef.current) applyBootstrap(next); }} />}
    {tokensOpen && <Suspense fallback={null}><TokenPanel bootstrap={bootstrap} initialSection={settingsSection} onClose={closeSettings} onAccountChanged={load} onLogout={logout} /></Suspense>}
    {!pushOfferDismissed && <PushNotificationCard compact onDismiss={() => {
      localStorage.setItem("tasktopia:push-offer-dismissed", "1");
      setPushOfferDismissed(true);
    }} />}
    <aside className="realtime-notices" aria-live="polite" aria-label="События страны">
      {notices.map((notice) => <article key={notice.id} className={`realtime-notice realtime-notice-${notice.tone}`}>
        <button className="realtime-notice-content" type="button" disabled={!notice.target} onClick={() => {
          if (!notice.target) return;
          void openCanonicalTask(new URLSearchParams({ id: notice.target.id }).toString());
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
