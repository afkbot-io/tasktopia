import { expect, it } from "vitest";
import { cityMapKeyAction } from "../src/client/city-map-keyboard";

const event = (key: string, code = key) => ({ key, code, ctrlKey: false, altKey: false, metaKey: false, isComposing: false, defaultPrevented: false });
it("maps arrows and physical WASD in either language, zoom and Home to bounded camera actions", () => {
  expect(cityMapKeyAction(event("ArrowRight"))).toEqual({ kind: "PAN", x: 1, y: 0 });
  expect(cityMapKeyAction(event("ц", "KeyW"))).toEqual({ kind: "PAN", x: 0, y: -1 });
  expect(cityMapKeyAction(event("ф", "KeyA"))).toEqual({ kind: "PAN", x: -1, y: 0 });
  expect(cityMapKeyAction(event("+", "Equal"))).toEqual({ kind: "ZOOM", direction: 1 });
  expect(cityMapKeyAction(event("-", "Minus"))).toEqual({ kind: "ZOOM", direction: -1 });
  expect(cityMapKeyAction(event("Home"))).toEqual({ kind: "HOME" });
});
it("never consumes application shortcuts, composition, editable fields or a modal dialog", () => {
  for (const option of ["ctrlKey", "altKey", "metaKey", "isComposing", "defaultPrevented"] as const)
    expect(cityMapKeyAction({ ...event("ArrowRight"), [option]: true })).toBeUndefined();
  expect(cityMapKeyAction(event("ArrowRight"), { editable: true, dialog: false })).toBeUndefined();
  expect(cityMapKeyAction(event("ArrowRight"), { editable: false, dialog: true })).toBeUndefined();
  expect(cityMapKeyAction(event("Tab"))).toBeUndefined();
});
