import { expect, it } from 'vitest';
import { AppNavigation, readNavigationState, type NavigationView } from '../src/client/app-navigation';
import { taskLink, taskResolutionQuery } from '../src/client/task-navigation';

const city: NavigationView = { countryId: 'country-a', cityId: 'city-a', mode: 'CITY', cityView: { center: { x: 12, y: 34 }, scale: .8 } };
function historyFixture() {
  const entries: { state: unknown; url: string }[] = [{ state: null, url: '/' }]; let index = 0;
  const history = { get state() { return entries[index].state; }, replaceState(state: unknown, _unused: string, url?: string | URL | null) { entries[index] = { state: structuredClone(state), url: String(url) }; },
    pushState(state: unknown, _unused: string, url?: string | URL | null) { entries.splice(index + 1); entries.push({ state: structuredClone(state), url: String(url) }); index++; },
    go(delta: number) { index = Math.max(0, Math.min(entries.length - 1, index + delta)); } };
  return { history, entries, url: () => entries[index].url };
}
it('keeps A/B/browser Back/Forward and closes the task chain to its city camera', () => {
  const f = historyFixture(), nav = new AppNavigation(f.history, f.url);
  nav.view(city); nav.task(city, { id: 'a', taskNumber: 1 }, false); nav.task(city, { id: 'b', taskNumber: 2 }, false);
  f.history.go(-1); expect(nav.current()?.task?.id).toBe('a'); expect(nav.current()?.view.cityView).toEqual(city.cityView);
  f.history.go(1); expect(nav.current()?.task?.id).toBe('b');
  nav.close(city); expect(nav.current()?.task).toBeUndefined(); expect(nav.current()?.view).toEqual(city);
  f.history.go(1); expect(nav.current()?.task?.id).toBe('a');
});
it('preserves direct task entry and separates city/country navigation without recording every pan', () => {
  const f = historyFixture(); f.history.replaceState(null, '', '/task/7?countryId=country-a&taskId=a');
  const nav = new AppNavigation(f.history, f.url);
  nav.task(city, { id: 'a', taskNumber: 7 }, true); expect(f.entries).toHaveLength(1);
  nav.close(city); expect(nav.current()?.view.mode).toBe('CITY'); expect(f.entries).toHaveLength(1);
  nav.view({ ...city, cityView: { center: { x: 90, y: 100 }, scale: 1 } }); expect(f.entries).toHaveLength(1);
  nav.view({ countryId: 'country-b', cityId: 'city-b', mode: 'CITY' }); expect(f.entries).toHaveLength(2);
  f.history.go(-1); expect(nav.current()?.view.cityView?.center).toEqual({ x: 90, y: 100 });
});
it('ignores foreign or malformed history data and does not retain mutable camera references', () => {
  expect(readNavigationState({ version: 1, kind: 'other' })).toBeNull();
  expect(readNavigationState({ kind: 'tasktopia.navigation', version: 1, view: { ...city, cityView: { center: { x: Infinity, y: 2 }, scale: 1 } }, taskDepth: 0 })).toBeNull();
  const f = historyFixture(), nav = new AppNavigation(f.history, f.url), view = structuredClone(city);
  nav.view(view); view.cityView!.center.x = 999; expect(nav.current()?.view.cityView?.center.x).toBe(12);
});
it('records a waiting card before its response, upgrades that same history entry and keeps UUID links resolvable', () => {
  const f = historyFixture(), nav = new AppNavigation(f.history, f.url), id = '12345678-1234-1234-1234-123456789abc';
  nav.view(city); nav.pending(city, id, false); expect(f.entries).toHaveLength(2);
  expect(taskResolutionQuery(new URL(f.url(), 'https://tasktopia.online'))).toBe(`id=${id}`);
  nav.task(city, { id, taskNumber: 42 }, false); expect(f.entries).toHaveLength(2);
  expect(f.url()).toBe(taskLink(city.countryId, { id, taskNumber: 42 }));
  f.history.go(-1); expect(nav.current()?.task).toBeUndefined();
  expect(taskResolutionQuery(new URL('https://tasktopia.online/task/42?countryId=country-a'))).toBe('number=42&countryId=country-a');
  expect(taskResolutionQuery(new URL('https://tasktopia.online/task/0'))).toBeNull();
  expect(taskResolutionQuery(new URL('https://tasktopia.online/task?taskId=untrusted'))).toBeNull();
});

it('keeps the map entry when a restored task becomes ready after browser Back', () => {
  const f = historyFixture(), nav = new AppNavigation(f.history, f.url), task = { id: 'a', taskNumber: 40 };
  nav.view(city);
  const mapUrl = f.url();
  nav.pending(city, task.id, false);
  nav.close(city);
  f.history.go(1);
  expect(nav.current()?.task?.pending).toBe(true);
  f.history.go(-1);
  const mapState = nav.current();

  nav.task(city, task, false, true);
  expect(f.url()).toBe(mapUrl);
  expect(nav.current()).toEqual(mapState);
  expect(f.entries).toHaveLength(2);

  // The pending Forward entry remains usable and can be canonicalized in place.
  f.history.go(1);
  nav.task(city, task, false, true);
  expect(f.url()).toBe(taskLink(city.countryId, task));
  expect(nav.current()?.task?.pending).toBeUndefined();
  expect(nav.current()?.taskDepth).toBe(1);
  expect(f.entries).toHaveLength(2);
  nav.close(city);
  expect(f.url()).toBe(mapUrl);
  expect(nav.current()?.task).toBeUndefined();
});

it('keeps a newer task entry when an older restore reports readiness', () => {
  const f = historyFixture(), nav = new AppNavigation(f.history, f.url);
  nav.view(city);
  nav.pending(city, 'a', false);
  f.history.go(-1);
  nav.pending(city, 'b', false);
  const pendingB = nav.current(), pendingUrl = f.url();

  nav.task(city, { id: 'a', taskNumber: 40 }, false, true);
  expect(nav.current()).toEqual(pendingB);
  expect(f.url()).toBe(pendingUrl);
  expect(f.entries).toHaveLength(2);

  nav.task(city, { id: 'b', taskNumber: 41 }, false, true);
  expect(nav.current()?.task?.id).toBe('b');
  expect(nav.current()?.taskDepth).toBe(1);
  expect(f.url()).toBe(taskLink(city.countryId, { id: 'b', taskNumber: 41 }));
});

it.each(['number', 'UUID'])('canonicalizes an unowned direct %s task entry without adding history', kind => {
  const f = historyFixture(), id = '12345678-1234-1234-1234-123456789abc', task = { id, taskNumber: 42 };
  const directUrl = kind === 'number' ? `/task/42?countryId=country-a&taskId=${id}` : `/task?countryId=country-a&taskId=${id}`;
  f.history.replaceState(null, '', directUrl);
  const nav = new AppNavigation(f.history, f.url);

  nav.task(city, task, true, true);
  expect(f.entries).toHaveLength(1);
  expect(f.url()).toBe(taskLink(city.countryId, task));
  expect(nav.current()?.task?.id).toBe(id);
  expect(nav.current()?.task?.standalone).toBe(true);
  expect(nav.current()?.taskDepth).toBe(0);
});
