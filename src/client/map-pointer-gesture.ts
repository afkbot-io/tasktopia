export type MapGesturePoint = { x: number; y: number };
export type MapGestureTransform = {
  center: MapGesturePoint;
  panX: number;
  panY: number;
  scale: number;
  pointers: number;
};

function midpoint(points: readonly MapGesturePoint[]): MapGesturePoint {
  const [first, second = first] = points;
  return { x: (first!.x + second!.x) / 2, y: (first!.y + second!.y) / 2 };
}

function distance(points: readonly MapGesturePoint[]): number {
  if (points.length < 2) return 0;
  return Math.hypot(points[1]!.x - points[0]!.x, points[1]!.y - points[0]!.y);
}

/** Tracks pointer geometry without knowing how a particular map stores its camera. */
export class MapPointerGestureTracker {
  private readonly points = new Map<number, MapGesturePoint>();
  private previousCenter: MapGesturePoint | null = null;
  private previousDistance = 0;

  get pointerCount(): number { return this.points.size; }

  start(pointerId: number, point: MapGesturePoint): void {
    this.points.set(pointerId, point);
    this.rebase();
  }

  move(pointerId: number, point: MapGesturePoint): MapGestureTransform | null {
    if (!this.points.has(pointerId)) return null;
    const previousCenter = this.previousCenter;
    const previousDistance = this.previousDistance;
    this.points.set(pointerId, point);
    const active = [...this.points.values()].slice(0, 2);
    const center = midpoint(active);
    const nextDistance = distance(active);
    this.previousCenter = center;
    this.previousDistance = nextDistance;
    return {
      center,
      panX: previousCenter ? center.x - previousCenter.x : 0,
      panY: previousCenter ? center.y - previousCenter.y : 0,
      scale: active.length > 1 && previousDistance > 0 ? nextDistance / previousDistance : 1,
      pointers: active.length,
    };
  }

  end(pointerId: number): void {
    this.points.delete(pointerId);
    this.rebase();
  }

  cancel(): void {
    this.points.clear();
    this.previousCenter = null;
    this.previousDistance = 0;
  }

  private rebase(): void {
    const active = [...this.points.values()].slice(0, 2);
    this.previousCenter = active.length ? midpoint(active) : null;
    this.previousDistance = distance(active);
  }
}

export function bindMapPointerGestures(
  element: HTMLElement | SVGElement,
  onTransform: (transform: MapGestureTransform) => void,
  options: { onEnd?: (moved: boolean) => void; shouldStart?: (event: PointerEvent) => boolean } = {},
): () => void {
  const tracker = new MapPointerGestureTracker();
  let moved = false;
  const down = (event: PointerEvent) => {
    if ((event.pointerType === "mouse" && event.button !== 0) || options.shouldStart?.(event) === false) return;
    if (tracker.pointerCount === 0) moved = false;
    tracker.start(event.pointerId, { x: event.clientX, y: event.clientY });
    try { element.setPointerCapture?.(event.pointerId); } catch { /* Safari and synthetic pointer streams can omit native capture. */ }
    if (event.cancelable) event.preventDefault();
  };
  const move = (event: PointerEvent) => {
    const transform = tracker.move(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!transform) return;
    moved ||= Math.abs(transform.panX) + Math.abs(transform.panY) > 2 || Math.abs(transform.scale - 1) > .006;
    onTransform(transform);
    if (event.cancelable) event.preventDefault();
  };
  const finish = (event: PointerEvent) => {
    const wasActive = tracker.pointerCount > 0;
    tracker.end(event.pointerId);
    try { if (element.hasPointerCapture?.(event.pointerId)) element.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    if (wasActive && tracker.pointerCount === 0) options.onEnd?.(moved);
  };
  const cancel = (event: PointerEvent) => {
    const wasActive = tracker.pointerCount > 0;
    tracker.cancel();
    try { if (element.hasPointerCapture?.(event.pointerId)) element.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    if (wasActive) options.onEnd?.(moved);
  };
  const listen = (type: string, listener: (event: PointerEvent) => void) => element.addEventListener(type, listener as EventListener);
  const unlisten = (type: string, listener: (event: PointerEvent) => void) => element.removeEventListener(type, listener as EventListener);
  listen("pointerdown", down);
  listen("pointermove", move);
  listen("pointerup", finish);
  listen("pointercancel", cancel);
  listen("lostpointercapture", finish);
  return () => {
    tracker.cancel();
    unlisten("pointerdown", down);
    unlisten("pointermove", move);
    unlisten("pointerup", finish);
    unlisten("pointercancel", cancel);
    unlisten("lostpointercapture", finish);
  };
}
