import { describe, expect, it, vi } from "vitest";
import { loadGameAssets, type GameAssetLoader } from "../src/client/game-asset-loader";

describe("loadGameAssets", () => {
  it("makes CDN assets available through their original aliases when the CDN request fails", async () => {
    const load = vi.fn<GameAssetLoader["load"]>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(undefined);
    const add = vi.fn<GameAssetLoader["add"]>();
    const url = "https://store.tasktopia.online/game-assets/v5/revisions/f6e6cd231e7003ac/atlas/road-v2/surface.png";

    await loadGameAssets({ load, add }, [url], "https://tasktopia.online");

    expect(load).toHaveBeenNthCalledWith(1, [url]);
    expect(add).toHaveBeenCalledWith([{
      alias: url,
      src: "/game-assets/v5/revisions/f6e6cd231e7003ac/atlas/road-v2/surface.png",
    }]);
    expect(load).toHaveBeenNthCalledWith(2, [url]);
  });
});
