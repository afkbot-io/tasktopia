import { taskLink } from './task-navigation';

export type NavigationView = {
  countryId: string; cityId: string | null; mode: 'PLANET' | 'CITY';
  cityView?: { center: { x: number; y: number }; scale: number };
  planetView?: { camera: { panX: number; panY: number; zoom: number }; sector: number };
};
export type NavigationState = { kind: 'tasktopia.navigation'; version: 1; view: NavigationView;
  entryId?: string; task?: { id: string; taskNumber?: number; standalone: boolean; pending?: true }; taskDepth: number };
type HistoryPort = Pick<History, 'state' | 'pushState' | 'replaceState' | 'go'>;
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128;
export function readNavigationState(value: unknown): NavigationState | null {
  if (!value || typeof value !== 'object') return null;
  const state = value as Partial<NavigationState>, view = state.view;
  if (state.kind !== 'tasktopia.navigation' || state.version !== 1 || !view || !identifier(view.countryId)
    || view.cityId !== null && !identifier(view.cityId) || !['CITY', 'PLANET'].includes(view.mode)
    || view.mode === 'CITY' && !view.cityId || !Number.isInteger(state.taskDepth) || state.taskDepth! < 0 || state.taskDepth! > 500) return null;
  if (view.cityView && (!Number.isFinite(view.cityView.center?.x) || !Number.isFinite(view.cityView.center?.y)
    || !Number.isFinite(view.cityView.scale) || view.cityView.scale < .8 || view.cityView.scale > 4)) return null;
  if (view.planetView && (!Number.isInteger(view.planetView.sector) || !view.planetView.camera
    || !Number.isFinite(view.planetView.camera.panX) || !Number.isFinite(view.planetView.camera.panY)
    || !Number.isFinite(view.planetView.camera.zoom) || view.planetView.camera.zoom < .82 || view.planetView.camera.zoom > 8.5)) return null;
  if (state.task && (!identifier(state.task.id) || (state.task.pending !== true && (!Number.isInteger(state.task.taskNumber) || state.task.taskNumber! < 1)) || typeof state.task.standalone !== 'boolean')) return null;
  if(state.entryId!==undefined&&!identifier(state.entryId))return null;
  return structuredClone(state) as NavigationState;
}
const viewUrl = (view: NavigationView) => `/?${new URLSearchParams({ countryId: view.countryId, ...(view.mode === 'CITY' && view.cityId ? { cityId: view.cityId } : {}) })}`;
const samePlace = (a: NavigationView, b: NavigationView) => a.countryId === b.countryId && a.cityId === b.cityId && a.mode === b.mode;

/** Browser history owns route entries; camera changes only replace the pose. */
export class AppNavigation {
  private dismissedView: NavigationView | undefined;
  private pendingPose: { owner: string; url: string; view: NavigationView } | undefined;
  private poseTimer: ReturnType<typeof setTimeout> | undefined;
  private interruptedPoses=new Map<string,NavigationView>();
  constructor(private readonly history: HistoryPort, private readonly url: () => string) {}
  current() {
    const current=readNavigationState(this.history.state);
    return current&&this.pendingPose&&this.pendingPose.owner===current.entryId&&this.pendingPose.url===this.url()
      ? {...current,view:structuredClone(this.pendingPose.view)} : current;
  }
  /** Session teardown and native history restoration must discard the old
   * entry's deferred pose, never write it into its successor. */
  private dropPendingPose() { clearTimeout(this.poseTimer);this.poseTimer=undefined;this.pendingPose=undefined; }
  cancelPose() { this.dropPendingPose();this.interruptedPoses.clear(); }
  private flushPose() {
    const pending=this.pendingPose;this.dropPendingPose();
    const current=readNavigationState(this.history.state);
    if(pending&&current&&pending.owner===current.entryId&&pending.url===this.url()&&samePlace(current.view,pending.view)){
      this.history.replaceState({...current,view:pending.view},'',pending.url);
      if(current.entryId)this.interruptedPoses.delete(current.entryId);}
  }
  /** Consume an explicit dismiss once. Native Back/Forward keeps its own pose. */
  restore(value: unknown): NavigationState | null {
    this.dropPendingPose();
    const state = readNavigationState(value), shown = this.dismissedView;
    this.dismissedView = undefined;
    if(!state)return null;
    const interrupted=state.entryId?this.interruptedPoses.get(state.entryId):undefined;
    const view=!state.task&&shown&&samePlace(state.view,shown)?shown:
      interrupted&&samePlace(state.view,interrupted)?interrupted:undefined;
    if(!view)return state;
    const next = { ...state, view: structuredClone(view) };
    this.history.replaceState(next, '', state.task?this.url():viewUrl(view));
    if(state.entryId)this.interruptedPoses.delete(state.entryId);
    return next;
  }
  view(view: NavigationView) {
    this.flushPose();
    this.dismissedView = undefined;
    const current = this.current(), next: NavigationState = { kind: 'tasktopia.navigation', version: 1, view, taskDepth: 0,
      entryId:current&&samePlace(current.view,view)&&!current.task?current.entryId??crypto.randomUUID():crypto.randomUUID() };
    if (current && samePlace(current.view, view) && !current.task) this.history.replaceState(next, '', viewUrl(view));
    else if (!current) this.history.replaceState(next, '', viewUrl(view));
    else this.history.pushState(next, '', viewUrl(view));
  }
  pose(view: NavigationView) {
    const current = this.current(); if (!current || !samePlace(current.view, view)) return;
    // Assign old session entries an additive identity once. Native Back may
    // interrupt the timer; Forward must recover that entry's own last frame.
    const entryId=current.entryId??crypto.randomUUID();
    if(!current.entryId)this.history.replaceState({...current,entryId},'',this.url());
    // Safari rejects more than100 history writes in10s. Keep the precise pose
    // available immediately, but coalesce animation frames to at most5/s.
    this.pendingPose={owner:entryId,url:this.url(),view:structuredClone(view)};
    this.interruptedPoses.delete(entryId);this.interruptedPoses.set(entryId,this.pendingPose.view);
    while(this.interruptedPoses.size>20)this.interruptedPoses.delete(this.interruptedPoses.keys().next().value!);
    this.poseTimer??=setTimeout(()=>this.flushPose(),200);
  }
  pending(view: NavigationView, id: string, standalone: boolean) {
    this.flushPose();
    this.dismissedView = undefined;
    const current = this.current(); if (current?.task?.id === id && current.view.countryId === view.countryId) return;
    const direct = !current && /^\/task(?:\/|\?)/.test(this.url());
    const next: NavigationState = { kind: 'tasktopia.navigation', version: 1, view, task: { id, standalone, pending: true },
      entryId:crypto.randomUUID(),taskDepth: direct ? 0 : Math.min(500, (current?.taskDepth ?? 0) + 1) };
    const url = direct ? this.url() : `/task?${new URLSearchParams({ countryId: view.countryId, taskId: id })}`;
    if (direct) this.history.replaceState(next, '', url); else this.history.pushState(next, '', url);
  }
  task(view: NavigationView, task: { id: string; taskNumber: number }, standalone: boolean, replace = false) {
    this.flushPose();
    if (replace && this.dismissedView) return;
    const current = this.current(), direct = !current && /^\/task(?:\/|\?)/.test(this.url());
    const sameTask = current?.task?.id === task.id && current.view.countryId === view.countryId;
    // A restored card may become ready after Back or a newer task took ownership.
    if (replace && !sameTask && !direct) return;
    this.dismissedView = undefined;
    const next: NavigationState = { kind: 'tasktopia.navigation', version: 1, view, task: { ...task, standalone },
      entryId:sameTask||replace?current?.entryId??crypto.randomUUID():crypto.randomUUID(),
      taskDepth: sameTask || replace ? current?.taskDepth ?? 0 : direct ? 0 : Math.min(500, (current?.taskDepth ?? 0) + 1) };
    if (direct || sameTask || replace) this.history.replaceState(next, '', taskLink(view.countryId, task));
    else this.history.pushState(next, '', taskLink(view.countryId, task));
  }
  close(view: NavigationView) {
    this.flushPose();
    const current = this.current();
    this.dismissedView = undefined;
    if (current?.task && current.taskDepth > 0) {
      this.dismissedView = structuredClone(view);
      this.history.go(-current.taskDepth); return true;
    }
    this.history.replaceState({ kind: 'tasktopia.navigation', version: 1, view, taskDepth: 0,entryId:current?.entryId??crypto.randomUUID() }, '', viewUrl(view));
    return false;
  }
}
