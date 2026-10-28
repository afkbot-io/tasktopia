import { createElement, lazy, useState, type ComponentType } from 'react';

/** Reuse completed code preload without suspending the first component mount. */
export function createPreloadedComponent<P extends object>(load: () => Promise<{ default: ComponentType<P> }>) {
  let ready: ComponentType<P> | undefined;
  let pending: Promise<{ default: ComponentType<P> }> | undefined;
  const preload = () => pending ??= Promise.resolve().then(load).then(module => {
    ready = module.default;
    return module;
  });
  const Deferred = lazy(preload);
  function PreloadedComponent(props: P) {
    // Keep this mount's component type stable if a pending preload finishes
    // while its fallback is visible. Later mounts can use the ready module.
    const [Selected] = useState<ComponentType<P>>(() => ready ?? Deferred);
    return createElement(Selected, props);
  }
  return { Component: PreloadedComponent, preload };
}
