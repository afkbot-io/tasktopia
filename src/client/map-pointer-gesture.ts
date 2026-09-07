export type MapGesturePoint = { x: number; y: number };
export type MapGestureTransform = {
  center: MapGesturePoint;
  panX: number;
  panY: number;
  scale: number;
  pointers: number;
  /** Sticky for the whole contact, including slow motion and return to origin. */
  moved: boolean;
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
  private readonly origins = new Map<number, MapGesturePoint>();
  private previousCenter: MapGesturePoint | null = null;
  private previousDistance = 0;
  private moved = false;

  get pointerCount(): number { return this.points.size; }
  get hasMoved(): boolean { return this.moved; }

  start(pointerId: number, point: MapGesturePoint): void {
    if (this.points.size === 0) this.moved = false;
    this.points.set(pointerId, point);
    this.origins.set(pointerId, point);
    if (this.points.size > 1) this.moved = true;
    this.rebase();
  }

  move(pointerId: number, point: MapGesturePoint): MapGestureTransform | null {
    if (!this.points.has(pointerId)) return null;
    const origin = this.origins.get(pointerId)!;
    this.moved ||= Math.abs(point.x - origin.x) + Math.abs(point.y - origin.y) > 2;
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
      moved: this.moved,
    };
  }

  end(pointerId: number): void {
    this.points.delete(pointerId);
    this.origins.delete(pointerId);
    if (this.points.size === 0) this.moved = false;
    this.rebase();
  }

  cancel(): void {
    this.points.clear();
    this.origins.clear();
    this.moved = false;
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
  options: {
    onEnd?: (moved: boolean) => void;
    onNavigationStart?: () => void;
    shouldStart?: (event: PointerEvent) => boolean;
  } = {},
): () => void {
  const tracker = new MapPointerGestureTracker();
  const down = (event: PointerEvent) => {
    if ((event.pointerType === "mouse" && event.button !== 0) || options.shouldStart?.(event) === false) return;
    const wasMoved = tracker.hasMoved;
    tracker.start(event.pointerId, { x: event.clientX, y: event.clientY });
    // A second contact is navigation even without a pointermove. Notify before
    // either finger can produce a tap, without sending a fake camera transform.
    if (!wasMoved && tracker.hasMoved) options.onNavigationStart?.();
    try { element.setPointerCapture?.(event.pointerId); } catch { /* Safari and synthetic pointer streams can omit native capture. */ }
    if (event.cancelable) event.preventDefault();
  };
  const move = (event: PointerEvent) => {
    const wasMoved = tracker.hasMoved;
    const transform = tracker.move(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!transform) return;
    if (!wasMoved && transform.moved) options.onNavigationStart?.();
    onTransform(transform);
    if (event.cancelable) event.preventDefault();
  };
  const finish = (event: PointerEvent) => {
    const wasActive = tracker.pointerCount > 0;
    const moved = tracker.hasMoved;
    tracker.end(event.pointerId);
    try { if (element.hasPointerCapture?.(event.pointerId)) element.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    if (wasActive && tracker.pointerCount === 0) options.onEnd?.(moved);
  };
  const cancel = (event: PointerEvent) => {
    const wasActive = tracker.pointerCount > 0;
    const moved = tracker.hasMoved;
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
