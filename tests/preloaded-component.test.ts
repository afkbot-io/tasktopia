import { createElement, Suspense } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createPreloadedComponent } from '../src/client/preloaded-component';

const heading = ({ title }: { title: string }) => createElement('h2', null, title);
const render = (Component: ReturnType<typeof createPreloadedComponent<{ title: string }>>['Component']) =>
  renderToString(createElement(Suspense, { fallback: createElement('p', null, 'Loading code') }, createElement(Component, { title: 'Actual task' })));

describe('completed component code preload', () => {
  it('shows the actual component on its first render after preload, without a Suspense fallback', async () => {
    const load = vi.fn(async () => ({ default: heading }));
    const owner = createPreloadedComponent(load);
    await owner.preload();
    const html = render(owner.Component);
    expect(html).toContain('<h2>Actual task</h2>');
    expect(html).not.toContain('Loading code');
    expect(html).not.toContain('<template');
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('retains a real fallback for an unfinished import and coalesces speculative and mounted loading', async () => {
    let resolve!: (module: { default: typeof heading }) => void;
    const load = vi.fn(() => new Promise<{ default: typeof heading }>(done => { resolve = done; }));
    const owner = createPreloadedComponent(load), preload = owner.preload();
    await Promise.resolve();
    expect(render(owner.Component)).toContain('Loading code');
    expect(owner.preload()).toBe(preload);
    expect(load).toHaveBeenCalledTimes(1);
    resolve({ default: heading }); await preload;
    expect(render(owner.Component)).toContain('<h2>Actual task</h2>');
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('starts an ordinary lazy import when there was no speculative preload', async () => {
    const load = vi.fn(async () => ({ default: heading }));
    const owner = createPreloadedComponent(load);
    expect(load).not.toHaveBeenCalled();
    expect(render(owner.Component)).toContain('Loading code');
    await owner.preload();
    expect(render(owner.Component)).toContain('<h2>Actual task</h2>');
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('keeps a rejected code import rejected for the existing reload/error boundary instead of marking it ready', async () => {
    const error = new Error('Unavailable UI module'), load = vi.fn(async () => { throw error; });
    const owner = createPreloadedComponent<{ title: string }>(load);
    const pending = owner.preload();
    await expect(pending).rejects.toBe(error);
    expect(owner.preload()).toBe(pending);
    await expect(owner.preload()).rejects.toBe(error);
    expect(render(owner.Component)).not.toContain('<h2>Actual task</h2>');
    expect(load).toHaveBeenCalledTimes(1);
  });
});
