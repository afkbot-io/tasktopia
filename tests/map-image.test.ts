import { afterEach, describe, expect, it, vi } from "vitest";
import { loadMapImage } from "../src/client/map-image";
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("map image cancellation", () => {
  it("cancels a stalled image request and allows a fresh successful attempt", async () => {
    vi.useFakeTimers();
    const remove = vi.fn();
    let succeed = false;
    vi.stubGlobal("Image", class { src = ""; removeAttribute = remove; decode() { return succeed ? Promise.resolve() : new Promise(() => {}); } });
    const outcome = loadMapImage("/terrain.png").catch(error => error.message);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await outcome).toContain("графику");
    expect(remove).toHaveBeenCalledWith("src");
    succeed = true;
    await expect(loadMapImage("/terrain.png")).resolves.toHaveProperty("src", "/terrain.png");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("uses the SVG request mode for display-only CDN images and retains CORS for canvas", async () => {
    vi.stubGlobal("Image", class { src = ""; crossOrigin = null; decode() { return Promise.resolve(); } });
    await expect(loadMapImage("https://cdn.example/terrain.png", undefined, { crossOrigin: null }))
      .resolves.toHaveProperty("crossOrigin", null);
    await expect(loadMapImage("https://cdn.example/terrain.png"))
      .resolves.toHaveProperty("crossOrigin", "anonymous");
  });
  it("releases pending image requests on map unmount", async () => {
    const remove = vi.fn();
    vi.stubGlobal("Image", class { removeAttribute = remove; decode() { return new Promise(() => {}); } });
    const controller = new AbortController();
    const outcome = loadMapImage("/terrain.png", controller.signal);
    controller.abort();
    await expect(outcome).rejects.toHaveProperty("name", "AbortError");
    expect(remove).toHaveBeenCalledWith("src");
  });
});
