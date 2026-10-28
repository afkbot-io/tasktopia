import { taskLink } from './task-navigation';

export type NavigationView = {
  countryId: string; cityId: string | null; mode: 'PLANET' | 'CITY';
  cityView?: { center: { x: number; y: number }; scale: number };
  planetView?: { camera: { panX: number; panY: number; zoom: number }; sector: number };
};
export type NavigationState = { kind: 'tasktopia.navigation'; version: 1; view: NavigationView;
  task?: { id: string; taskNumber?: number; standalone: boolean; pending?: true }; taskDepth: number };
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
  return structuredClone(state) as NavigationState;
}
const viewUrl = (view: NavigationView) => `/?${new URLSearchParams({ countryId: view.countryId, ...(view.mode === 'CITY' && view.cityId ? { cityId: view.cityId } : {}) })}`;
const samePlace = (a: NavigationView, b: NavigationView) => a.countryId === b.countryId && a.cityId === b.cityId && a.mode === b.mode;

/** Browser history owns route entries; camera changes only replace the pose. */
export class AppNavigation {
  constructor(private readonly history: HistoryPort, private readonly url: () => string) {}
  current() { return readNavigationState(this.history.state); }
  view(view: NavigationView) {
    const current = this.current(), next: NavigationState = { kind: 'tasktopia.navigation', version: 1, view, taskDepth: 0 };
    if (current && samePlace(current.view, view) && !current.task) this.history.replaceState(next, '', viewUrl(view));
    else if (!current) this.history.replaceState(next, '', viewUrl(view));
    else this.history.pushState(next, '', viewUrl(view));
  }
  pose(view: NavigationView) {
    const current = this.current(); if (!current || !samePlace(current.view, view)) return;
    this.history.replaceState({ ...current, view }, '', this.url());
  }
  pending(view: NavigationView, id: string, standalone: boolean) {
    const current = this.current(); if (current?.task?.id === id && current.view.countryId === view.countryId) return;
    const direct = !current && /^\/task(?:\/|\?)/.test(this.url());
    const next: NavigationState = { kind: 'tasktopia.navigation', version: 1, view, task: { id, standalone, pending: true },
      taskDepth: direct ? 0 : Math.min(500, (current?.taskDepth ?? 0) + 1) };
    const url = direct ? this.url() : `/task?${new URLSearchParams({ countryId: view.countryId, taskId: id })}`;
    if (direct) this.history.replaceState(next, '', url); else this.history.pushState(next, '', url);
  }
  task(view: NavigationView, task: { id: string; taskNumber: number }, standalone: boolean, replace = false) {
    const current = this.current(), direct = !current && /^\/task(?:\/|\?)/.test(this.url());
    const sameTask = current?.task?.id === task.id && current.view.countryId === view.countryId;
    // A restored card may become ready after Back or a newer task took ownership.
    if (replace && !sameTask && !direct) return;
    const next: NavigationState = { kind: 'tasktopia.navigation', version: 1, view, task: { ...task, standalone },
      taskDepth: sameTask || replace ? current?.taskDepth ?? 0 : direct ? 0 : Math.min(500, (current?.taskDepth ?? 0) + 1) };
    if (direct || sameTask || replace) this.history.replaceState(next, '', taskLink(view.countryId, task));
    else this.history.pushState(next, '', taskLink(view.countryId, task));
  }
  close(view: NavigationView) {
    const current = this.current();
    if (current?.task && current.taskDepth > 0) { this.history.go(-current.taskDepth); return true; }
    this.history.replaceState({ kind: 'tasktopia.navigation', version: 1, view, taskDepth: 0 }, '', viewUrl(view));
    return false;
  }
}
