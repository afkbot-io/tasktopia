import { afterEach, describe, expect, it, vi } from "vitest";

const { unload } = vi.hoisted(() => ({ unload: vi.fn(async () => undefined) }));
vi.mock("pixi.js", () => ({ Assets: { unload } }));

import { AssetLease, leasedAssetCount } from "../src/client/asset-lease-registry";

afterEach(() => {
  vi.useRealTimers();
  unload.mockClear();
});

describe("AssetLease", () => {
  it("deduplicates overlapping loads without serializing independent assets", async () => {
    let finishFirst!: () => void;
    const firstPending = new Promise<void>((resolve) => { finishFirst = resolve; });
    const firstLoader = vi.fn(() => firstPending);
    const secondLoader = vi.fn(async () => undefined);
    const first = new AssetLease();
    const second = new AssetLease();

    const firstLoad = first.load(["a.png"], firstLoader);
    const secondLoad = second.load(["a.png", "b.png"], secondLoader);

    expect(firstLoader).toHaveBeenCalledWith(["a.png"]);
    expect(secondLoader).toHaveBeenCalledWith(["b.png"]);
    finishFirst();
    await Promise.all([firstLoad, secondLoad]);
    first.dispose();
    second.dispose();
  });

  it("unloads a texture only after the last scene releases it", async () => {
    vi.useFakeTimers();
    const loader = vi.fn(async () => undefined);
    const first = new AssetLease();
    const second = new AssetLease();
    await first.load(["shared.png"], loader);
    await second.load(["shared.png"], loader);
    expect(leasedAssetCount()).toBeGreaterThanOrEqual(1);

    first.dispose();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(unload).not.toHaveBeenCalledWith("shared.png");
    second.dispose();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(unload).toHaveBeenCalledWith("shared.png");
  });

  it("reuses a loaded texture when a new scene acquires it during the unload grace period", async () => {
    vi.useFakeTimers();
    const loader = vi.fn(async () => undefined);
    const first = new AssetLease();
    await first.load(["warm.png"], loader);
    first.dispose();

    const second = new AssetLease();
    await second.load(["warm.png"], loader);
    expect(loader).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(unload).not.toHaveBeenCalledWith("warm.png");

    second.dispose();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(unload).toHaveBeenCalledWith("warm.png");
  });

  it("does not unload an asset while its cancelled scene load is still pending", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const lease = new AssetLease();
    const loading = lease.load(["slow.png"], () => pending);
    lease.dispose();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(unload).not.toHaveBeenCalledWith("slow.png");
    finish();
    await loading;
    await vi.advanceTimersByTimeAsync(250);
    expect(unload).toHaveBeenCalledWith("slow.png");
  });
});
