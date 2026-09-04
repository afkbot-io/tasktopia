import { describe, expect, it, vi } from "vitest";
import { stopPixiApplication } from "../src/client/pixi-app-lifecycle";

describe("Pixi application lifecycle", () => {
  it("does not call a missing stop method during partial StrictMode startup cleanup", () => {
    expect(() => stopPixiApplication({})).not.toThrow();
  });

  it("stops an initialized application", () => {
    const stop = vi.fn();
    stopPixiApplication({ stop });
    expect(stop).toHaveBeenCalledOnce();
  });
});
