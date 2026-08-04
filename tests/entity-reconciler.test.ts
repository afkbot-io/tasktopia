import { describe, expect, it } from "vitest";
import { reconcileEntityViews, type EntityViewRecord } from "../src/client/entity-reconciler";

describe("entity view reconciler", () => {
  it("keeps stable views and replaces only changed or removed entities", () => {
    type View = { value: number; disposed: boolean };
    const records = new Map<string, EntityViewRecord<View>>();
    const attached: View[] = [];
    const disposed: View[] = [];
    const reconcile = (source: Map<string, number>) => reconcileEntityViews({
      source,
      records,
      signatureOf: String,
      create: (value) => ({ value, disposed: false }),
      attach: (view) => { attached.push(view); },
      dispose: (view) => { view.disposed = true; disposed.push(view); },
    });

    expect(reconcile(new Map([["a", 1], ["b", 2]]))).toBe(2);
    const stable = records.get("a")!.view;
    expect(reconcile(new Map([["a", 1], ["b", 3]]))).toBe(1);
    expect(records.get("a")!.view).toBe(stable);
    expect(disposed.map((view) => view.value)).toEqual([2]);

    expect(reconcile(new Map([["b", 3]]))).toBe(0);
    expect(stable.disposed).toBe(true);
    expect(records.has("a")).toBe(false);
    expect(attached.map((view) => view.value)).toEqual([1, 2, 3]);
  });
});
