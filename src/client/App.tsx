import { GameIcon } from "./components/ui";
import { InvitationEntry } from "./components/InvitationEntry";
import { countrySelectionPending, invalidateCountrySelections, selectCountrySession } from "./country-selection";
import { useDialogFocus } from "./use-dialog-focus";
import { WorldDigest } from "./components/WorldDigest";
import { MapDependencies } from "./components/MapDependencies";
import type { MapDependencySelection } from "./map-dependencies";
import { MapAttention, type MapAttentionSelection } from "./components/MapAttention";
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
import { DialogLoadState, PanelLoadState, UiLoadBoundary } from "./components/UiLoadState";
import { advanceMapSceneCaches, clearMapSceneCaches, invalidateTransportSceneCaches, loadCityScene, rememberCountryRevision, retainCityScene } from "./map-scene-cache";
import { clearTaskDetailCache, invalidateTaskDetails, taskEventRefreshesDependencies } from "./task-detail-cache";
import { taskResolutionQuery } from "./task-navigation";
import { clearPlanetAtlasCache } from "./planet-atlas-cache";
import { CoalescedRefresh } from "./coalesced-refresh";
import { WorldPreferences } from "./components/WorldPreferences";
import { WorldAmbientLighting } from "./components/WorldAmbientLighting";
import { bindCityAudioLifecycle, playCitySound, silenceCityAudio } from "./city-audio";
import { AppNavigation, readNavigationState, type NavigationView } from './app-navigation';
import type { CityViewState } from './city-view-state';
import { acceptsCityNavigationPose } from './city-navigation-pose';
import type { TaskCardDto } from '../shared/task-read-contracts';
import { RealtimeReplay } from './realtime-replay';
import { matchesRealtimeScope } from './realtime-scope';

const loadWorldRenderer = () => import("./components/WorldCanvas").then(module => ({ default: module.WorldCanvas }));
const WorldCanvas = lazy(loadWorldRenderer);
const PlanetAtlasCanvas = lazy(() => import("./components/PlanetAtlasCanvas").then((module) => ({ default: module.PlanetAtlasCanvas })));
const CityDocuments = lazy(() => import("./components/CityDocuments").then(module => ({ default: module.CityDocuments })));
const CityDevelopmentPanel = lazy(() => import("./components/CityDevelopmentPanel").then(module => ({ default: module.CityDevelopmentPanel })));
const CityAlbum = lazy(() => import('./components/CityAlbum').then(module => ({ default: module.CityAlbum })));
const TaskModal = lazy(() => import("./components/TaskModal").then((module) => ({ default: module.TaskModal })));
const ArchiveRecordModal = lazy(() => import("./components/ArchiveRecordModal").then((module) => ({ default: module.ArchiveRecordModal })));
const TokenPanel = lazy(() => import("./components/TokenPanel").then((module) => ({ default: module.TokenPanel })));

type SessionState = "INITIALIZING" | "SIGNING_OUT" | "ANONYMOUS" | "AUTHENTICATED" | "RECOVERABLE_ERROR";
type CityFocus = Pick<CityDto, "id" | "name" | "center" | "bounds">;
type BuildingNavigationTarget = Pick<BuildingEventContext, "id" | "origin" | "city">;

function TaskModalFallback({ onClose, standalone = false, error, onRetry }: { onClose: () => void; standalone?: boolean; error?: string; onRetry?: () => void }) {
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus(dialogRef, { onClose });
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

export function App() {
  useEffect(bindCityAudioLifecycle, []);
  const [invitationToken, setInvitationToken] = useState(() => {
    const token = new URLSearchParams(location.hash.slice(1)).get("invite");
    if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) {
      sessionStorage.setItem("tasktopia-invitation", token);
      history.replaceState(null, "", location.pathname + location.search);
    }
    return sessionStorage.getItem("tasktopia-invitation");
  });
  const [wheelNavigation] = useState(createAtlasWheelNavigation);
  const [navigation] = useState(() => new AppNavigation(window.history, () => location.pathname + location.search));
  const [cityViewMemory] = useState(() => new Map<string, CityViewState>());
  const navigationRestoringRef = useRef(false), navigationRequestRef = useRef(0), navigationRestoreEpochRef = useRef(0);
  const restoredTaskRef = useRef<string | null>(null);
  const taskNavigationAbortRef = useRef<AbortController | undefined>(undefined);
  const [cityViewRestore, setCityViewRestore] = useState<{ scope: string; view: CityViewState; token: number }>();
  const cityRestoreTokensRef = useRef(new Map<string, number>());
  const [planetRestoreToken, setPlanetRestoreToken] = useState(0);
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
  const logoutEpochRef = useRef<number | undefined>(undefined);
  const [renderedAuthenticationEpoch, setRenderedAuthenticationEpoch] = useState(0);
  const bootstrapLoadRef = useRef(new CoalescedRefresh());
  const bootstrapAbortRef = useRef<AbortController | undefined>(undefined);
  const [selectedArchiveRecord, setSelectedArchiveRecord] = useState<string | null>(null);
  const [tokensOpen, setTokensOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<"mcp" | "account">("mcp");
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [directoryFocus, setDirectoryFocus] = useState<{ cityId: string; districtId: string }>();
  const [directorySection, setDirectorySection] = useState<"cities" | "archive">("cities");
  const [countryMenuOpen, setCountryMenuOpen] = useState(false);
  const [countryDialog, setCountryDialog] = useState<"manage" | null>(null);
  const [showDistricts, setShowDistricts] = useState(false);
  const [selectedTransportRoute,setSelectedTransportRoute]=useState<string>();
  const [mapMode, setMapMode] = useState<MapLevel>("PLANET");
  const [mapTransition, setMapTransition] = useState<AtlasTransition | null>(null);
  const mapTransitionAbortRef = useRef<AbortController | null>(null);
  const [focusCity, setFocusCity] = useState<CityFocus | null>(null);
  const [preparedCityScene, setPreparedCityScene] = useState<CitySceneDto | null>(null);
  useEffect(() => preparedCityScene ? retainCityScene(preparedCityScene) : undefined, [preparedCityScene]);
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
  const [attention, setAttention] = useState<MapAttentionSelection>({ scope: "", ids: [], active: false });
  const [dependencyTask, setDependencyTask] = useState<{ scope: string; id: string }>();
  const [dependencyData, setDependencyData] = useState<{ scope: string; selection?: MapDependencySelection }>({ scope: "" });
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const closeDocuments = useCallback(() => setDocumentsOpen(false), []);
  const [developmentOpen, setDevelopmentOpen] = useState(false);
  const [albumOpen, setAlbumOpen] = useState(false);
  const closeAlbum = useCallback(() => setAlbumOpen(false), []);
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
  const cancelPendingNavigation = useCallback(() => {
    navigationRequestRef.current++; navigationRestoreEpochRef.current++; taskEntryRequestRef.current++;
    navigationRestoringRef.current = false; restoredTaskRef.current = null;
    taskNavigationAbortRef.current?.abort();
  }, []);
  const navigationView = useCallback((): NavigationView | null => {
    if (!countryId) return null;
    const city = mapMode === 'CITY' ? focusCity ?? bootstrap?.initialCity : null;
    return { countryId, cityId: city?.id ?? null, mode: city ? 'CITY' : 'PLANET',
      cityView: city ? cityViewMemory.get(countryId + ':' + city.id) : undefined,
      planetView: planetViewMemory.get('last') };
  }, [countryId, mapMode, focusCity, bootstrap?.initialCity, cityViewMemory, planetViewMemory]);
  const cameraAuthenticationEpoch = renderedAuthenticationEpoch;
  const rememberCityView = useCallback((view: CityViewState, meta?: { source: 'interaction' | 'cleanup'; restoreToken?: number }) => {
    const city = focusCity ?? bootstrap?.initialCity;
    if (!countryId || !city || meta?.source === 'cleanup' && navigationRestoringRef.current) return;
    const current: NavigationView = { countryId, cityId: city.id, mode: 'CITY' };
    const scope = current.countryId + ':' + current.cityId;
    if (eventCountryRef.current !== countryId || !acceptsCityNavigationPose(cameraAuthenticationEpoch, meta?.restoreToken, authenticationEpochRef.current, cityRestoreTokensRef.current.get(scope))) return;
    cityViewMemory.delete(scope); cityViewMemory.set(scope, view);
    while (cityViewMemory.size > 20) cityViewMemory.delete(cityViewMemory.keys().next().value!);
    if (!navigationRestoringRef.current) navigation.pose({ ...current, cityView: view });
  }, [countryId, focusCity, bootstrap?.initialCity, cityViewMemory, navigation, cameraAuthenticationEpoch]);
  const rememberPlanetNavigation = useCallback((view: PlanetViewState) => {
    rememberPlanetView(view);
    const current = navigationView();
    if (current?.mode === 'PLANET' && !navigationRestoringRef.current) navigation.pose({ ...current, planetView: view });
  }, [navigationView, navigation, rememberPlanetView]);
  const recordTaskNavigation = useCallback((task: TaskCardDto) => {
    const view = navigationView();
    if (view && task.id === selectedTask && task.countryId === countryId && eventCountryRef.current === countryId && renderedAuthenticationEpoch === authenticationEpochRef.current) {
      navigation.task(view, task, Boolean(taskEntry), navigationRestoringRef.current || restoredTaskRef.current === task.id);
      if (restoredTaskRef.current === task.id) restoredTaskRef.current = null;
    }
  }, [navigation, navigationView, selectedTask, countryId, taskEntry, renderedAuthenticationEpoch]);
  useEffect(() => {
    const view = navigationView();
    if (view && selectedTask && restoredTaskRef.current !== selectedTask && !navigationRestoringRef.current) navigation.pending(view, selectedTask, Boolean(taskEntry));
    if (view && deepLinkHandledRef.current && sessionState === 'AUTHENTICATED' && !selectedTask && !taskEntry && !navigationRestoringRef.current) navigation.view(view);
  }, [navigation, navigationView, selectedTask, taskEntry, sessionState]);
  useEffect(() => { setSelectedSite(null); setDirectoryFocus(undefined); setAlbumOpen(false); }, [countryId, sessionState]);
  const closeSite = useCallback(() => setSelectedSite(null), []);
  const closeTask = useCallback(() => {
    restoredTaskRef.current = null;
    taskEntryRequestRef.current++; navigationRequestRef.current++; navigationRestoreEpochRef.current++;
    taskNavigationAbortRef.current?.abort(); mapTransitionAbortRef.current?.abort(); setMapTransition(null);
    const view = navigationView();
    const city = selectedTask && taskEntry ? focusCity : null;
    const destination = city && countryId ? { ...view!, countryId, cityId: city.id, mode: 'CITY' as const, cityView: cityViewMemory.get(countryId + ':' + city.id) } : view;
    navigationRestoringRef.current = Boolean(navigation.current()?.task && navigation.current()!.taskDepth > 0);
    const wentBack = destination ? navigation.close(destination) : false;
    setSelectedTask(null); setTaskEntry(null); setMapTransitionError('');
    if (!wentBack) { navigationRestoringRef.current = false; if (destination) setMapMode(destination.mode); else window.history.replaceState(null, '', '/'); }
  }, [taskEntry, selectedTask, focusCity, countryId, navigationView, navigation, cityViewMemory]);
  const selectVisibleTask = useCallback((id: string) => {
    cancelPendingNavigation(); setTaskEntry(null); setSelectedTask(id);
  }, [cancelPendingNavigation]);
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
  const clearPrivateSessionUi = useCallback(() => {
    sessionGenerationRef.current++; navigationRequestRef.current++; navigationRestoreEpochRef.current++;
    navigationRestoringRef.current = false; restoredTaskRef.current = null;
    deepLinkHandledRef.current = false;
    setTaskEntry(taskResolutionQuery(new URL(location.href)));
    taskNavigationAbortRef.current?.abort(); mapTransitionAbortRef.current?.abort();
    setMapTransition(null); setMapInvalidations([]); setMapMode('PLANET');
    setFocusCity(null); setFocusTask(null); setPreparedCityScene(null); setRetainedCityKey(null);
    setSelectedTask(null); setSelectedSite(null); setSelectedArchiveRecord(null);
    setTokensOpen(false); setDirectoryOpen(false); setDirectoryFocus(undefined); setCountryMenuOpen(false); setCountryDialog(null);
    setDocumentsOpen(false); setDevelopmentOpen(false); setAlbumOpen(false); setSelectedTransportRoute(undefined);
    setAttention({ scope: '', ids: [], active: false }); setDependencyTask(undefined); setDependencyData({ scope: '' }); setNotices([]);
    eventCountryRef.current = undefined; lastWorldEventIdRef.current = 0;
    clearMapSceneCaches(); clearTaskDetailCache(); clearPlanetAtlasCache(); silenceCityAudio();
    cityViewMemory.clear(); cityRestoreTokensRef.current.clear(); planetViewMemory.clear();
  }, [cityViewMemory, planetViewMemory]);
  const transitionMap = useCallback(async (
    to: MapLevel,
    focus: { x: number; y: number },
    commit: (signal: AbortSignal) => Promise<void> | void,
    destinationName?: string,
    preserveNavigation = false,
  ) => {
    if (!preserveNavigation) cancelPendingNavigation();
    mapTransitionAbortRef.current?.abort();
    const controller = new AbortController();
    mapTransitionAbortRef.current = controller;
    const transition = { ...createAtlasTransition(mapMode, to, focus, performance.now()), destinationName };
    setMapTransitionError("");
    setMapTransition(transition);
    try {
      if (controller.signal.aborted) return;
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
        // The renderer has already presented its first frame. Do not keep a
        // finished city covered for a decorative exit animation.
        setMapTransition(current => current?.id === transition.id ? null : current);
        if (mapTransitionAbortRef.current === controller) mapTransitionAbortRef.current = null;
      }
    }
  }, [mapMode, cancelPendingNavigation]);
  const logout = useCallback(async () => {
    if (logoutEpochRef.current === authenticationEpochRef.current) return;
    const epoch = ++authenticationEpochRef.current;
    logoutEpochRef.current = epoch;
    // Revoke mutable authority before React can render a replacement socket
    // effect, or the server can disconnect the session during the POST.
    eventCountryRef.current = undefined;
    setRenderedAuthenticationEpoch(epoch);
    invalidateCountrySelections();
    bootstrapAbortRef.current?.abort();
    clearPrivateSessionUi();
    setBootstrap(null);
    setSessionState("SIGNING_OUT");
    setAuthError("");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    let stopWaiting!: () => void;
    const interrupted = new Promise<never>((_, reject) => {
      stopWaiting = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", stopWaiting, { once: true });
    });
    const ownsLogout = () => epoch === authenticationEpochRef.current && logoutEpochRef.current === epoch;
    try {
      await Promise.race([clearPushSubscriptionForLogout(controller.signal), interrupted]);
      if (!ownsLogout()) return;
      await api("/api/auth/logout", { method: "POST", signal: controller.signal });
      if (ownsLogout()) setSessionState("ANONYMOUS");
    } catch {
      if (ownsLogout()) {
        setAuthError("Не удалось подтвердить выход. Повторите проверку подключения.");
        setSessionState("RECOVERABLE_ERROR");
      }
    } finally {
      window.clearTimeout(timeout);
      controller.signal.removeEventListener("abort", stopWaiting);
      controller.abort();
      if (logoutEpochRef.current === epoch) logoutEpochRef.current = undefined;
    }
  }, [clearPrivateSessionUi]);

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
    setDocumentsOpen(false);
    setDevelopmentOpen(false);
  }, []);

  const load = useCallback(() => bootstrapLoadRef.current.request(async () => {
    if (logoutEpochRef.current === authenticationEpochRef.current) return;
    const generation = sessionGenerationRef.current;
    const controller = new AbortController();
    bootstrapAbortRef.current = controller;
    const deadline = window.setTimeout(() => controller.abort(new DOMException('Не удалось загрузить страну вовремя. Повторите попытку.', 'TimeoutError')), 15_000);
    setSessionState((current) => current === "AUTHENTICATED" ? current : "INITIALIZING");
    try {
      const next = await api<BootstrapDto>("/api/bootstrap", { signal: controller.signal });
      if (generation !== sessionGenerationRef.current) return;
      const countryChanged = eventCountryRef.current !== next.country.id;
      if (countryChanged) {
        clearMapSceneCaches();
        clearTaskDetailCache();
        setMapInvalidations([]);
        setFocusTask(null);
        setPreparedCityScene(null); setRetainedCityKey(null);
        eventCountryRef.current = next.country.id;
        lastWorldEventIdRef.current = next.eventCursor;
          setNotices([]);
      }
      rememberCountryRevision(next.country.id, next.country.worldVersion);
      setBootstrap(current => current?.country.id === next.country.id ? {
        ...next, country: { ...next.country, worldVersion: Math.max(next.country.worldVersion, current.country.worldVersion) },
        eventCursor: Math.max(next.eventCursor, current.eventCursor),
      } : next);
      setFocusCity((current) => countryChanged ? next.initialCity : current ?? next.initialCity);
      if (countryChanged) setMapMode("PLANET");
      setSessionState("AUTHENTICATED");
      setAuthError("");
    } catch (error) {
      if (generation !== sessionGenerationRef.current) return;
      if (error instanceof ApiError && error.status === 401) {
        authenticationEpochRef.current++;
        setRenderedAuthenticationEpoch(authenticationEpochRef.current);
        invalidateCountrySelections();
        clearPrivateSessionUi();
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
    } finally {
      window.clearTimeout(deadline);
      if (bootstrapAbortRef.current === controller) bootstrapAbortRef.current = undefined;
    }
  }), [clearPrivateSessionUi]);

  const openBuilding = useCallback((target: BuildingNavigationTarget, session = bootstrap, keepCamera = false, fromResolver = false) => {
    if (!fromResolver) {
      restoredTaskRef.current = null;
      taskNavigationAbortRef.current?.abort(); navigationRequestRef.current++; navigationRestoreEpochRef.current++;
      navigationRestoringRef.current = false; setTaskEntry(null);
    }
    if (!navigationRestoringRef.current && session && (mapMode !== 'CITY' || focusCity?.id !== target.city.id)) {
      navigation.view({ countryId: session.country.id, cityId: target.city.id, mode: 'CITY',
        cityView: cityViewMemory.get(session.country.id + ':' + target.city.id), planetView: planetViewMemory.get('last') });
    }
    const focus = () => {
      setFocusTask(keepCamera ? null : { origin: target.origin, token: Date.now() });
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
    }, undefined, true);
  }, [bootstrap, countryId, focusCity?.id, mapMode, transitionMap, navigation, cityViewMemory, planetViewMemory]);

  const openTaskFromSearch = useCallback((result: TaskSearchResultDto) => {
    openBuilding({
      id: result.id,
      origin: result.origin,
      city: { id: result.cityId, name: result.cityName, center: result.cityCenter, bounds: result.cityBounds },
    });
  }, [openBuilding]);

  const openCanonicalTask = useCallback(async (query: string, entryOnly = false, restoreView?: NavigationView, fromHistory = false) => {
    if (!fromHistory) cancelPendingNavigation();
    taskNavigationAbortRef.current?.abort();
    const controller = new AbortController(); taskNavigationAbortRef.current = controller;
    const deadline = window.setTimeout(() => controller.abort(new DOMException('Не удалось открыть задачу вовремя. Повторите попытку.', 'TimeoutError')), 15_000);
    const navigationRequest = ++navigationRequestRef.current;
    const generation = sessionGenerationRef.current;
    const epoch = authenticationEpochRef.current;
    const request = entryOnly ? ++taskEntryRequestRef.current : 0;
    const entryCancelled = () => navigationRequest !== navigationRequestRef.current || entryOnly && request !== taskEntryRequestRef.current;
    setMapTransitionError("");
    try {
      const resolved = await api<TaskResolutionDto>(`/api/tasks/resolve?${query}`, { signal: controller.signal });
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
      const keepCamera = Boolean(restoreView?.cityView && restoreView.countryId === resolved.countryId && restoreView.cityId === resolved.cityId);
      if (keepCamera) {
        const scope = resolved.countryId + ':' + resolved.cityId;
        cityViewMemory.set(scope, restoreView!.cityView!);
        cityRestoreTokensRef.current.set(scope, navigationRequest);
        setCityViewRestore({ scope, view: restoreView!.cityView!, token: navigationRequest });
      }
      if (entryOnly) {
        setFocusCity(target.city);
        setFocusTask(keepCamera ? null : { origin: target.origin, token: Date.now() });
        setSelectedTask(target.id);
      } else openBuilding(target, session, keepCamera, true);
    } catch (error) {
      if (epoch !== authenticationEpochRef.current || entryCancelled()) return;
      if (error instanceof ApiError && error.status === 401) { void load().catch(() => undefined); return; }
      setMapTransitionError(error instanceof Error ? error.message : "Не удалось открыть задачу");
    } finally {
      window.clearTimeout(deadline);
      if (taskNavigationAbortRef.current === controller) taskNavigationAbortRef.current = undefined;
    }
  }, [bootstrap, countryId, applyBootstrap, openBuilding, load, cityViewMemory, cancelPendingNavigation]);

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

  const openPlanetCity = useCallback(async (selectedCountryId: string, cityId: string, focus = {x:.5,y:.5}, cityName?: string) => {
    if (!bootstrap) return;
    setSelectedTransportRoute(undefined);
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
      setMapTransition(current => current && !signal.aborted ? withAtlasTransitionPhase(current, 'PREPARE') : current);
      const ready = new Promise<void>(resolve => {cityReadyResolverRef.current=resolve;});
      setPreparedCityScene(scene);
      setFocusCity(scene.city);
      setFocusTask(null);
      setShowDistricts(false);
      setMapMode("CITY");
      await Promise.race([ready,new Promise<void>(resolve=>window.setTimeout(resolve,12_000))]);
      if(!signal.aborted) cityReadyResolverRef.current=null;
    }, cityName);
  }, [bootstrap,applyBootstrap,transitionMap]);
  useEffect(() => () => {
    sessionGenerationRef.current++;
    mapTransitionAbortRef.current?.abort();
    bootstrapAbortRef.current?.abort();
    taskNavigationAbortRef.current?.abort();
  }, []);
  useEffect(() => {
    const restore = async (event: PopStateEvent) => {
      if (!bootstrap || sessionState !== 'AUTHENTICATED') return;
      const state = readNavigationState(event.state), query = taskResolutionQuery(new URL(location.href));
      restoredTaskRef.current = state?.task?.id ?? null;
      const request = ++navigationRequestRef.current, restoreEpoch = ++navigationRestoreEpochRef.current, epoch = authenticationEpochRef.current;
      navigationRestoringRef.current = true; mapTransitionAbortRef.current?.abort(); setMapTransition(null);
      taskEntryRequestRef.current++; taskNavigationAbortRef.current?.abort(); setSelectedTask(null); setMapTransitionError('');
      try {
        if (state?.task || query) {
          const entry = state?.task ? state.task.standalone : true;
          const taskQuery = state?.task ? new URLSearchParams({ id: state.task.id }).toString() : query!;
          setTaskEntry(entry ? taskQuery : null);
          await openCanonicalTask(taskQuery, entry, state?.view, true);
          return;
        }
        setTaskEntry(null);
        const url = new URL(location.href), view = state?.view;
        const destinationCountry = view?.countryId ?? url.searchParams.get('countryId') ?? bootstrap.country.id;
        let session = bootstrap;
        if (destinationCountry !== session.country.id || countrySelectionPending()) {
          session = await selectCountrySession(destinationCountry);
          if (epoch !== authenticationEpochRef.current) return;
          applyBootstrap(session, 'PLANET', true);
          if (request !== navigationRequestRef.current) return;
        }
        const cityId = view?.mode === 'CITY' ? view.cityId : view ? null : url.searchParams.get('cityId');
        if (cityId) {
          const scene = await loadCityScene(session.country.id, cityId, session.country.worldVersion);
          if (request !== navigationRequestRef.current || epoch !== authenticationEpochRef.current) return;
          if (view?.cityView) {
            const scope = session.country.id + ':' + cityId;
            cityViewMemory.set(scope, view.cityView); cityRestoreTokensRef.current.set(scope, request); setCityViewRestore({ scope, view: view.cityView, token: request });
          }
          setPreparedCityScene(scene); setFocusCity(scene.city); setFocusTask(null); setMapMode('CITY');
        } else {
          if (view?.planetView) planetViewMemory.set('last', view.planetView);
          setPlanetRestoreToken(value => value + 1); setPlanetEntryCountryId(session.country.id); setMapMode('PLANET');
        }
      } catch (error) {
        if (epoch === authenticationEpochRef.current && request === navigationRequestRef.current) {
          if (error instanceof ApiError && error.status === 401) void load().catch(() => undefined);
          else setMapTransitionError(error instanceof Error ? error.message : 'Не удалось вернуться к карте');
        }
      } finally { if (epoch === authenticationEpochRef.current && restoreEpoch === navigationRestoreEpochRef.current) navigationRestoringRef.current = false; }
    };
    const listener = (event: PopStateEvent) => { void restore(event); };
    window.addEventListener('popstate', listener); return () => window.removeEventListener('popstate', listener);
  }, [bootstrap, sessionState, applyBootstrap, cityViewMemory, planetViewMemory, openCanonicalTask, load]);
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
    else {
      const url = new URL(location.href), cityId = url.searchParams.get('cityId'), scope = url.searchParams.get('countryId') ?? bootstrap.country.id;
      if (cityId) void openPlanetCity(scope, cityId);
      else if (scope !== bootstrap.country.id) {
        const epoch = authenticationEpochRef.current, generation = sessionGenerationRef.current, request = ++navigationRequestRef.current;
        const current = () => epoch === authenticationEpochRef.current && generation === sessionGenerationRef.current && request === navigationRequestRef.current;
        void selectCountrySession(scope).then(next => { if (current()) applyBootstrap(next); })
          .catch(error => { if (current()) setMapTransitionError(error instanceof Error ? error.message : 'Не удалось открыть страну'); });
      }
      else { const view = navigationView(); if (view) navigation.view(view); }
    }
  }, [bootstrap, openCanonicalTask, openPlanetCity, taskEntry, navigation, navigationView, applyBootstrap]);
  const applyRealtimeEvent = useCallback((event: RealtimeEvent) => {
    if (!matchesRealtimeScope(countryId, renderedAuthenticationEpoch, eventCountryRef.current, authenticationEpochRef.current)
      || event.countryId !== countryId || event.id <= lastWorldEventIdRef.current) return;
    if (!event.type.startsWith("task.comment") && (event.type.startsWith("task.") || event.type.startsWith("district.") || event.type === "country.regenerated")) setAttentionRevision(value => value + 1);
    advanceMapSceneCaches(event);
    const affectedTask = invalidateTaskDetails(event);
    if (affectedTask === null || affectedTask === selectedTaskRef.current || taskEventRefreshesDependencies(event)) setTaskRevision(value => value + 1);
    lastWorldEventIdRef.current = event.id;
    setMapInvalidations(current => enqueueMapInvalidation(current, eventInvalidation(event)));
    if (countryOverviewEventImpact(event) !== "NONE") setPlanetRevision((value) => value + 1);
    const notice = presentRealtimeNotice(event);
    if (notice) {
      setNotices((current) => [...current.filter((item) => item.id !== notice.id), notice].slice(-3));
      window.setTimeout(() => setNotices((current) => current.filter((item) => item.id !== notice.id)), notice.tone === "success" ? 10_000 : 7_000);
      if (notice.tone === "success") playCitySound("bell");
    }
    setBootstrap((current) => current?.country.id === event.countryId
        ? { ...current, country: { ...current.country, worldVersion: event.worldVersion }, eventCursor: event.id }
        : current);
    setRevision((value) => value + 1);
    if (countryOverviewEventImpact(event) === "STRUCTURE" || event.type === "country.profile_updated") setBootstrapRefresh(value => value + 1);
  }, [countryId, renderedAuthenticationEpoch]);
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
    if (!countryId || !matchesRealtimeScope(countryId, renderedAuthenticationEpoch, eventCountryRef.current, authenticationEpochRef.current)) return;
    const epoch = renderedAuthenticationEpoch;
    let active = true;
    let disconnect: (() => void) | undefined;
    const currentScope = () => active && matchesRealtimeScope(countryId, epoch, eventCountryRef.current, authenticationEpochRef.current);
    void import("socket.io-client").then(({ io }) => {
      if (!currentScope()) return;
      const socket = io({ path: "/socket.io", withCredentials: true });
      let connectedOnce = false;
      let sessionCheck: Promise<void> | undefined;
      let sessionRetry: number | undefined;
      const recheckSession = () => {
        if (!currentScope() || sessionCheck) return;
        sessionCheck = load().then(() => {
          if (currentScope() && !socket.connected) socket.connect();
        }).catch(() => {
          // A database interruption is temporary; one bounded read owns each
          // retry. A confirmed 401 clears the private UI inside load().
          if (currentScope()) sessionRetry = window.setTimeout(recheckSession, 5_000);
        }).finally(() => { sessionCheck = undefined; });
      };
      const replay = new RealtimeReplay({
        countryId, cursor: () => lastWorldEventIdRef.current,
        read: (cursor, signal) => currentScope()
          ? api<RealtimeEvent[]>(`/api/events?after=${cursor}`, { signal })
          : Promise.reject(new DOMException('Replay cancelled', 'AbortError')),
        apply: applyRealtimeEvent, online: value => { if (currentScope()) setOnline(value); },
        commitCursor: cursor => { if (currentScope()) lastWorldEventIdRef.current = cursor; },
        resynchronize: async signal => {
          if (!currentScope() || signal.aborted) throw new DOMException('Recovery cancelled', 'AbortError');
          const epoch = authenticationEpochRef.current;
          try {
            const next = await api<BootstrapDto>('/api/bootstrap', { signal });
            if (!currentScope() || signal.aborted || epoch !== authenticationEpochRef.current) throw new DOMException('Recovery cancelled', 'AbortError');
            if (next.country.id !== countryId) { await load(); throw new DOMException('Recovery scope changed', 'AbortError'); }
            clearMapSceneCaches(); clearTaskDetailCache(); clearPlanetAtlasCache();
            rememberCountryRevision(next.country.id, next.country.worldVersion);
            setBootstrap(next);
            setFocusCity(current => current?.id === next.initialCity?.id ? next.initialCity : current);
            setPreparedCityScene(null); setRetainedCityKey(null);
            setTaskRevision(value => value + 1); setAttentionRevision(value => value + 1);
            setPlanetRevision(value => value + 1); setTransportRevision(value => value + 1);
            setMapInvalidations(current => enqueueMapInvalidation(current, {
              id: next.eventCursor, worldVersion: next.country.worldVersion, type: 'world.resync_required', resync: true,
            }));
            return next.eventCursor;
          } catch (error) {
            if (currentScope() && error instanceof ApiError && error.status === 401) void load().catch(() => undefined);
            throw error;
          }
        },
      });
      disconnect = () => { window.clearTimeout(sessionRetry); replay.close(); socket.disconnect(); };
      socket.on("connect", () => {
        if (!currentScope()) return;
        // The initial country bootstrap already clears scene caches. Only a
        // reconnect can have missed foreign transport events while offline.
        if (connectedOnce) invalidateForeignTransport();
        connectedOnce = true;
        void replay.connect();
      });
      socket.on("disconnect", reason => { replay.disconnect(); if (reason === 'io server disconnect') recheckSession(); });
      socket.on('connect_error', error => { if (error.message === 'unauthorized') recheckSession(); });
      socket.on("world:event", event => { if (currentScope()) replay.receive(event); });
      socket.on("atlas:invalidate", () => { if (currentScope()) invalidateForeignTransport(); });
    }).catch(() => { if (active && matchesRealtimeScope(countryId, renderedAuthenticationEpoch, eventCountryRef.current, authenticationEpochRef.current)) setOnline(false); });
    return () => { active = false; disconnect?.(); };
  }, [applyRealtimeEvent, countryId, invalidateForeignTransport, load, renderedAuthenticationEpoch]);

  if (sessionState === "SIGNING_OUT" || sessionState === "INITIALIZING" && !bootstrap) return <div className="app-loading" role="status"><div className="loader-square" /><span>{sessionState === "SIGNING_OUT" ? "Выходим из аккаунта…" : taskEntry ? "Открываем задачу…" : "Открываем мир…"}</span></div>;
  if (sessionState === "ANONYMOUS" || sessionState === "RECOVERABLE_ERROR" || !bootstrap) {
    return <AuthScreen initialError={sessionState === "RECOVERABLE_ERROR" ? authError : ""} onAuthenticated={load} />;
  }

  if (invitationToken) return <InvitationEntry token={invitationToken} email={bootstrap.user.email} onDone={async () => { sessionStorage.removeItem("tasktopia-invitation"); setInvitationToken(null); await load(); }} />;
  const activeCity = focusCity ?? bootstrap.initialCity;
  const dependencyScope = `${bootstrap.user.id}:${countryId}:${activeCity?.id}`;
  if (taskEntry) return <main className="task-entry" aria-label="Карточка задачи">
    {selectedTask ? <UiLoadBoundary key={`${countryId}:${selectedTask}`} fallback={<DialogLoadState label="Задача" onClose={closeTask} error />}><Suspense fallback={<TaskModalFallback standalone onClose={closeTask} />}>
      <TaskModal onTaskReady={recordTaskNavigation} onNavigateTask={id => { void openCanonicalTask(new URLSearchParams({ id }).toString(), Boolean(taskEntry)); }} onAuthenticationRequired={load} standalone key={`${countryId}:${selectedTask}`} countryId={bootstrap.country.id} taskId={selectedTask} revision={taskRevision}
        onShowDependencies={id => { setDependencyData({ scope: "" }); setDependencyTask({ scope: dependencyScope, id }); closeTask(); }} onClose={closeTask} />
    </Suspense></UiLoadBoundary> : <TaskModalFallback standalone onClose={closeTask} error={mapTransitionError} onRetry={() => { void openCanonicalTask(taskEntry, true); }} />}
  </main>;
  const effectiveMapMode = mapMode;
  const headerCity = effectiveMapMode === "CITY" ? activeCity : null;
  return <main className="app-shell grid h-full grid-rows-[auto_minmax(0,1fr)]">
    <header className="app-header map-toolbar" aria-label="Навигация по миру" onClickCapture={event => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const trigger = target.closest('button, summary');
      if (!trigger || trigger.closest('.game-popover-panel, .map-legend-panel, .country-switcher, .task-search-results, [data-map-catalog]')) return;
      for (const panel of event.currentTarget.querySelectorAll<HTMLDetailsElement>('details[open]')) {
        if (!panel.contains(trigger)) panel.open = false;
      }
      if (!trigger.closest('.country-title-button')) setCountryMenuOpen(false);
      if (!trigger.closest('.header-city')) setDirectoryOpen(false);
      setDevelopmentOpen(false);
    }}>
      <div className="map-toolbar-location">
        <div className="brand-mark hidden shrink-0 xl:flex"><GameIcon name="world" /> TASKTOPIA</div>
        <div className="relative min-w-0">
        <button className="country-title-button grid min-w-0 border-0 border-l-0 px-0 text-left xl:border-l xl:border-line xl:pl-5" aria-haspopup="dialog" aria-expanded={countryMenuOpen} onClick={() => { setDirectoryOpen(false); setCountryMenuOpen((value) => !value); }}>
          <span className="text-xs font-bold tracking-[.08em] text-[var(--ui-muted)]">МИР</span>
          <strong className="block max-w-[180px] truncate text-sm text-paper md:max-w-[240px]">{bootstrap.country.name}</strong>
        </button>
        {countryMenuOpen && <CountrySwitcher bootstrap={bootstrap} onClose={() => setCountryMenuOpen(false)} onBootstrap={next => { if (renderedAuthenticationEpoch === authenticationEpochRef.current) { cancelPendingNavigation(); applyBootstrap(next); } }} onCities={() => { setCountryMenuOpen(false); setDirectoryFocus(undefined); setDirectorySection("cities"); setDirectoryOpen(true); }} onManage={() => { setCountryMenuOpen(false); setCountryDialog("manage"); }} />}
        </div>
        {headerCity && <button className="header-city" aria-label={`Районы города ${headerCity.name}`} onClick={() => { setDirectoryFocus({cityId:headerCity.id,districtId:""});setDirectorySection("cities");setDirectoryOpen(value=>!value); }}>
          <span className="text-xs font-bold tracking-[.08em] text-[var(--ui-muted)]">ГОРОД</span>
          <strong className="block max-w-[180px] truncate text-sm text-paper">{headerCity.name}<span aria-hidden="true"> ▾</span></strong>
        </button>}
      </div>

      <div className="header-search map-toolbar-search">
        <TaskSearch key={countryId} countryId={bootstrap.country.id} revision={attentionRevision} onSelect={openTaskFromSearch} />
      </div>

      <div className="map-toolbar-actions">
        <nav className="flex items-center justify-end gap-1.5" aria-label="Действия карты">
          <WorldAmbientLighting />
          {effectiveMapMode === "CITY" && activeCity && <GamePopover label="Фильтры" icon={<GameIcon name="filter" />} activeLabel={attention.scope===`${bootstrap.user.id}:${countryId}:${activeCity.id}`?attention.label:undefined}>
            <strong>Показать на карте</strong>
            <MapAttention key={`${bootstrap.user.id}:${countryId}:${activeCity.id}`} userId={bootstrap.user.id} countryId={bootstrap.country.id} cityId={activeCity.id} revision={attentionRevision} onChange={setAttention} onSelectTask={openTaskFromSearch} />
            <button className="city-development-toggle" onClick={event => { const menu = event.currentTarget.closest("details"); if (menu) menu.open = false; setDevelopmentOpen(value => !value); }} aria-expanded={developmentOpen}>Развитие города</button>
            <button onClick={event => { const menu = event.currentTarget.closest('details'); if (menu) { menu.open = false; menu.querySelector('summary')?.focus(); } setAlbumOpen(true); }}>Альбом города</button>
          </GamePopover>}
          <GamePopover label="Меню" icon={<GameIcon name="menu" />} className="world-menu">
            <strong>{bootstrap.country.name}</strong>
            <button onClick={() => {setDirectoryOpen(false);setCountryMenuOpen(true);}}>Выбрать мир</button>
            <button onClick={() => { setCountryMenuOpen(false);setDirectoryFocus(undefined);setDirectorySection("cities");setDirectoryOpen(true); }}>Города</button>
            <button onClick={event => { const menu=event.currentTarget.closest("details"); if(menu) {menu.open=false; menu.querySelector("summary")?.focus();} setDirectoryOpen(false);setDevelopmentOpen(false);setDocumentsOpen(true); }}>Документы</button>
            <button onClick={openArchive}>Архив проекта</button>
            <button onClick={() => openSettings("mcp")}>Подключить MCP</button>
            <button onClick={() => openSettings("account")}>Аккаунт и настройки</button>
            <div className="mobile-menu-tools"><WorldPreferences /><MapLegend /></div>
            <button onClick={() => {setCountryMenuOpen(false);setCountryDialog("manage");}}>Паспорт страны</button>
          </GamePopover>
          <WorldPreferences />
          <MapLegend />
          <WorldDigest key={`${bootstrap.user.id}:${countryId}`} userId={bootstrap.user.id} countryId={bootstrap.country.id} revision={revision} onAuthenticationRequired={load} onTask={id => { void openCanonicalTask(new URLSearchParams({ id }).toString()); }} />
          <ProfilePresence initial={bootstrap.user.name.slice(0, 1).toUpperCase()} online={online} onOpen={() => openSettings("account")} />
        </nav>
      </div>
    </header>

    <section className="map-region" onWheelCapture={event => {
      if (event.target instanceof Element && event.target.closest("[data-country-control]")) return;
      wheelNavigation.observe({ at: event.timeStamp, deltaY: event.deltaY });
    }}>
      <Suspense fallback={<div className="app-loading" role="status"><div className="loader-square" /><span>Загружаем карту…</span></div>}>
          {effectiveMapMode === "PLANET" ? <PlanetAtlasCanvas key={countryId + ":" + planetRestoreToken}
            wheelNavigation={wheelNavigation} userId={bootstrap.user.id} activeCountryId={bootstrap.country.id}
            initialFocusCountryId={planetEntryCountryId ?? undefined} refreshToken={planetRevision}
            initialView={planetViewMemory.get("last")} onViewChange={rememberPlanetNavigation}
            onCitySelect={openPlanetCity} onCityIntent={prepareCityIntent}
          /> : !activeCity ? <div className="world-empty"><div className="empty-square" aria-hidden="true">＋</div><h2>Пока нет городов</h2><p>Создайте первый город через MCP — он сразу появится на планете.</p><button className="primary-button" onClick={() => openSettings("mcp")}>Подключить MCP</button></div> : null}
      </Suspense>
      {activeCity && (effectiveMapMode === "CITY" || preparedCityScene !== null || retainedCityKey===`${bootstrap.country.id}:${activeCity.id}`) && <div aria-hidden={effectiveMapMode !== "CITY"} style={{ position:"absolute", inset:0, visibility:effectiveMapMode === "CITY" ? "visible" : "hidden", pointerEvents:effectiveMapMode === "CITY" ? "auto" : "none" }}>
        <Suspense fallback={<div className="app-loading" role="status">Готовим город…</div>}>
          <WorldCanvas initialView={cityViewMemory.get(bootstrap.country.id + ':' + activeCity.id)} onViewChange={rememberCityView} restoreView={cityViewRestore?.scope === bootstrap.country.id + ':' + activeCity.id ? cityViewRestore : undefined} onInspectTask={(scope, id) => { void openCanonicalTask(new URLSearchParams({ countryId: scope, id }).toString()); }} selectedTransportRoute={selectedTransportRoute} transportRevision={transportRevision} dependencies={dependencyTask?.scope === dependencyScope && dependencyData.scope === dependencyScope ? dependencyData.selection : undefined} attentionIds={attention.active && attention.scope === `${bootstrap.user.id}:${countryId}:${activeCity?.id}` ? attention.ids : undefined} onDistrictSelect={districtId => { if (activeCity) setDirectoryFocus({ cityId: activeCity.id, districtId }); setDirectorySection("cities"); setDirectoryOpen(true); }} active={effectiveMapMode === "CITY"} key={`${bootstrap.country.id}:${activeCity?.id ?? "world"}`} countryId={bootstrap.country.id} chunkSize={bootstrap.chunkSize} worldManifest={bootstrap.worldManifest} viewBounds={activeCity?.bounds ?? bootstrap.viewBounds} focusCity={activeCity} initialCityScene={preparedCityScene && preparedCityScene.city.id === activeCity?.id ? preparedCityScene : undefined} startAtMinimumScale={Boolean(preparedCityScene && preparedCityScene.city.id === activeCity?.id)} focusTask={focusTask} invalidations={mapInvalidations} onInvalidationsProcessed={acknowledgeCityInvalidations} showDistricts={showDistricts} onTaskSelect={selectVisibleTask} onArchiveSelect={openArchive} onSiteSelect={feature => { setSelectedTask(null); setSelectedSite({ countryId: bootstrap.country.id, feature }); }} onReady={() => {
                  setRetainedCityKey(`${bootstrap.country.id}:${activeCity.id}`);
                  cityReadyResolverRef.current?.();
                  cityReadyResolverRef.current = null;
                  performance.mark("tasktopia:city-first-frame");
                }} onCitySceneCommitted={(scope, scene) => {
                  const currentScope = () => matchesRealtimeScope(scope, renderedAuthenticationEpoch, eventCountryRef.current, authenticationEpochRef.current);
                  if (!currentScope()) return;
                  setPreparedCityScene(current => currentScope() && current?.city.id === scene.city.id ? scene : current);
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
        cancelPendingNavigation();
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
      {effectiveMapMode === "CITY" && activeCity && developmentOpen && <UiLoadBoundary key={dependencyScope} fallback={<PanelLoadState onClose={closeDevelopment} error />}><Suspense fallback={<PanelLoadState onClose={closeDevelopment} />}><CityDevelopmentPanel selectedRoute={selectedTransportRoute} key={dependencyScope} countryId={bootstrap.country.id} cityId={activeCity.id} revision={attentionRevision} onClose={closeDevelopment} onTask={id => { closeDevelopment(); selectVisibleTask(id); }} onRoute={id=>{setSelectedTransportRoute(id);closeDevelopment();}} onCity={(scope,id,name)=>{closeDevelopment();setSelectedTransportRoute(undefined);void openPlanetCity(scope,id,{x:.5,y:.5},name);}} /></Suspense></UiLoadBoundary>}
      {effectiveMapMode === "CITY" && activeCity && <DistrictPlans key={`${countryId}:${activeCity.id}`} countryId={bootstrap.country.id} cityId={activeCity.id} revision={revision} onSelect={districtId => {
        setDirectoryFocus({ cityId: activeCity.id, districtId }); setDirectorySection("cities"); setDirectoryOpen(true);
      }} />}
      {documentsOpen && <UiLoadBoundary fallback={<DialogLoadState label="Документы" onClose={closeDocuments} error />}><Suspense fallback={<DialogLoadState label="Загрузка документов" onClose={closeDocuments} />}><CityDocuments key={countryId} countryId={bootstrap.country.id} initialCityId={headerCity?.id} revision={attentionRevision} hidden={Boolean(selectedTask)} onClose={closeDocuments} onTask={selectVisibleTask} /></Suspense></UiLoadBoundary>}
      {directoryOpen && <CityDirectory key={`${countryId}:${directoryFocus?.districtId ?? "general"}`} initialFocus={directoryFocus} bootstrap={bootstrap} refreshToken={revision} initialSection={directorySection} onTaskNavigate={openTaskFromSearch} onClose={() => setDirectoryOpen(false)} onCityFocus={(city) => {
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
        }, city.name);
      }} onTaskSelect={selectVisibleTask} onArchiveRecordSelect={setSelectedArchiveRecord} />}
    </section>

    {albumOpen && activeCity && <UiLoadBoundary fallback={<DialogLoadState label="Альбом города" onClose={closeAlbum} error />}><Suspense fallback={<DialogLoadState label="Альбом города" onClose={closeAlbum} />}><CityAlbum key={`${countryId}:${activeCity.id}`} countryId={bootstrap.country.id} cityId={activeCity.id} cityName={activeCity.name} revision={attentionRevision} onClose={closeAlbum} onAuthenticationRequired={load} onTask={id => { setAlbumOpen(false); void openCanonicalTask(new URLSearchParams({ id }).toString()); }} /></Suspense></UiLoadBoundary>}
    {selectedTask && <UiLoadBoundary key={`${countryId}:${selectedTask}`} fallback={<DialogLoadState label="Задача" onClose={closeTask} error />}><Suspense fallback={<TaskModalFallback onClose={closeTask} />}><TaskModal onTaskReady={recordTaskNavigation} onNavigateTask={id => { void openCanonicalTask(new URLSearchParams({ id }).toString(), Boolean(taskEntry)); }} onAuthenticationRequired={load} key={`${countryId}:${selectedTask}`} countryId={bootstrap.country.id} taskId={selectedTask} revision={taskRevision} onShowDependencies={id => { setDependencyData({ scope: "" }); setDependencyTask({ scope: dependencyScope, id }); closeTask(); }} onClose={closeTask} /></Suspense></UiLoadBoundary>}
    {selectedSite?.countryId === bootstrap.country.id && <SiteHistoryModal feature={selectedSite.feature} onClose={closeSite} />}
    {selectedArchiveRecord && <UiLoadBoundary key={selectedArchiveRecord} fallback={<DialogLoadState label="Архив" onClose={closeArchiveRecord} error />}><Suspense fallback={<DialogLoadState label="Загрузка архива" onClose={closeArchiveRecord} />}><ArchiveRecordModal recordId={selectedArchiveRecord} onClose={closeArchiveRecord} /></Suspense></UiLoadBoundary>}
    {countryDialog && <CountryPanel bootstrap={bootstrap} onClose={() => setCountryDialog(null)} />}
    {tokensOpen && <UiLoadBoundary fallback={<DialogLoadState label="Настройки" onClose={closeSettings} error />}><Suspense fallback={<DialogLoadState label="Загрузка настроек" onClose={closeSettings} />}><TokenPanel bootstrap={bootstrap} initialSection={settingsSection} onClose={closeSettings} onAccountChanged={load} onLogout={logout} /></Suspense></UiLoadBoundary>}
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
