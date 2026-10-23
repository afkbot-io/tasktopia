import { expect, it, vi } from 'vitest';
import { Container, Graphics, Sprite } from 'pixi.js';
import type { ChunkTaskDto } from '../src/shared/contracts';
import { createTaskFocusView } from '../src/client/task-focus-view';

const task = (id: string, extra: Partial<ChunkTaskDto> = {}) => ({ id, districtId: 'active', status: 'IN_PROGRESS', workItemType: 'TASK', ...extra }) as ChunkTaskDto;
function building() {
  const view = new Container({ eventMode: 'static' });
  view.addChild(new Graphics().rect(-16, -32, 32, 32).fill(0x365647));
  return { view };
}
function fixture() {
  const buildings = new Map([['a', building()], ['b', building()]]);
  const platforms = new Map([['a', building()], ['b', building()]]);
  const incidents = new Map([['b', { container: new Container() }]]);
  const tasks = new Map([['a', task('a')], ['b', task('b')]]);
  const focus = createTaskFocusView();
  const update = (matches?: ReadonlySet<string>, activeDistrictIds = new Set(['active'])) => focus.update({ tasks, buildings, platforms, incidents, activeDistrictIds, matches, detail: true });
  const cleanup = () => { focus.destroy(); for (const item of [...buildings.values(), ...platforms.values()]) item.view.destroy({ children: true }); for (const item of incidents.values()) item.container.destroy(); };
  return { focus, buildings, platforms, incidents, tasks, update, cleanup };
}

it('dims nonmatches and their parcel/effects while preserving selection and a distinct empty result', () => {
  const f = fixture();
  try {
    f.update(); expect(f.buildings.get('a')!.view.alpha).toBe(1);
    const stats = f.update(new Set(['a']));
    expect(stats.dimmed).toBe(1);
    expect(f.buildings.get('a')!.view.alpha).toBe(1);
    expect(f.buildings.get('b')!.view.alpha).toBe(.16);
    expect(f.platforms.get('b')!.view.alpha).toBe(.16);
    expect(f.incidents.get('b')!.container.alpha).toBe(.16);
    expect(f.buildings.get('b')!.view.eventMode).toBe('static');
    expect(f.update(new Set()).dimmed).toBe(2);
    expect(f.buildings.get('a')!.view.alpha).toBe(.16);
    f.update(); expect(f.buildings.get('b')!.view.alpha).toBe(1);
  } finally { f.cleanup(); }
});

it('batches different badges on one tiny shared atlas and reuses sprites through filter changes', () => {
  const f = fixture();
  try {
    f.tasks.set('b', task('b', { workItemType: 'BUG' }));
    const first = f.update(); expect(first.badges).toBe(2); expect(first.textures).toBe(1);
    const a = f.buildings.get('a')!.view.children.at(-1) as Sprite;
    const b = f.buildings.get('b')!.view.children.at(-1) as Sprite;
    expect(a.texture).not.toBe(b.texture);
    expect(a.texture.source).toBe(b.texture.source);
    expect(a.texture.source.resource).toBeInstanceOf(Uint8Array);
    expect(a.texture.source.resource.byteLength).toBe(2904);
    expect(a.texture.source.scaleMode).toBe('nearest');
    expect(a.eventMode).toBe('none');
    f.update(new Set(['b']));
    expect(f.buildings.get('a')!.view.children.at(-1)).toBe(a);
    expect(f.buildings.get('b')!.view.children.at(-1)).toBe(b);
    expect(f.update(undefined, new Set()).badges).toBe(0);
    expect(a.destroyed).toBe(true); expect(b.destroyed).toBe(true);
    expect(f.buildings.get('a')!.view.destroyed).toBe(false);
  } finally { f.cleanup(); }
});

it('allocates the atlas lazily and destroys its owned frames and source without destroying buildings', () => {
  const f = fixture();
  expect(f.update(undefined, new Set()).textures).toBe(0);
  f.update();
  const texture = (f.buildings.get('a')!.view.children.at(-1) as Sprite).texture;
  const source = texture.source;
  const destroy = vi.spyOn(source, 'destroy');
  f.focus.destroy();
  expect(texture.destroyed).toBe(true);
  expect(destroy).toHaveBeenCalledTimes(1);
  expect(f.buildings.get('a')!.view.destroyed).toBe(false);
  f.cleanup();
  expect(destroy).toHaveBeenCalledTimes(1);
});

it('updates a replaced resident view and retires badges without retaining the old building', () => {
  const f = fixture();
  const old = f.buildings.get('a')!.view;
  try {
    f.update(); const badge = old.children.at(-1)!;
    f.buildings.set('a', building());
    f.tasks.set('a', task('a', { workItemType: 'BUG' }));
    expect(f.update().badges).toBe(2);
    expect(badge.destroyed).toBe(true); expect(old.destroyed).toBe(false);
    expect(f.buildings.get('a')!.view.children.at(-1)!.label).toContain('BUG');
    f.tasks.set('a', task('a', { status: 'COMPLETED' }));
    expect(f.update().badges).toBe(1);
  } finally { old.destroy({ children: true }); f.cleanup(); }
});

it('reads canonical metadata only for resident building IDs', () => {
  const f = fixture();
  try {
    const get = vi.spyOn(f.tasks, 'get');
    const values = vi.spyOn(f.tasks, 'values');
    f.update(new Set(['a']));
    expect(get.mock.calls.map(([id]) => id)).toEqual(['a', 'b']);
    expect(values).not.toHaveBeenCalled();
  } finally { f.cleanup(); }
});

it('composes resident appearance fades with the current mask without restoring nonmatches to opaque', () => {
  const f = fixture();
  const a = f.buildings.get('a')!.view, b = f.platforms.get('b')!.view;
  try {
    f.focus.setFadeOpacity(a, 0);
    f.update(new Set(['b'])); expect(a.alpha).toBe(0);
    f.focus.setFadeOpacity(a, .5); expect(a.alpha).toBe(.08);
    f.update(new Set(['a'])); expect(a.alpha).toBe(.5);
    f.focus.setFadeOpacity(b, .5); expect(b.alpha).toBe(.08);
    f.focus.setFadeOpacity(b, 1); expect(b.alpha).toBe(.16);
    f.update(); expect(b.alpha).toBe(1);
  } finally { f.cleanup(); }
});
