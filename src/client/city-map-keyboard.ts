export type CityMapKeyAction = { kind: "PAN"; x: number; y: number } | { kind: "ZOOM"; direction: 1 | -1 } | { kind: "HOME" };
type KeyInput = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "altKey" | "metaKey" | "isComposing" | "defaultPrevented">;
export function cityMapKeyAction(event: KeyInput, scope = { editable: false, dialog: false }): CityMapKeyAction | undefined {
  if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing || event.defaultPrevented || scope.editable || scope.dialog) return;
  const directions: Record<string, readonly [number, number]> = {
    ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    KeyA: [-1, 0], KeyD: [1, 0], KeyW: [0, -1], KeyS: [0, 1],
  };
  const direction = directions[event.code] ?? directions[event.key];
  if (direction) return { kind: "PAN", x: direction[0], y: direction[1] };
  if (event.key === "+" || event.key === "=" || event.code === "NumpadAdd") return { kind: "ZOOM", direction: 1 };
  if (event.key === "-" || event.code === "NumpadSubtract") return { kind: "ZOOM", direction: -1 };
  if (event.key === "Home") return { kind: "HOME" };
}
