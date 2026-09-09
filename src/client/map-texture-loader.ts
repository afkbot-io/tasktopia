import { extensions, ExtensionType, ImageSource, Texture, type LoaderParser } from "pixi.js";
import { loadMapImage } from "./map-image";

// Pixi's default bitmap worker has no deadline. Keep the normal Assets cache,
// alias fallback and unload lifecycle, but make a stalled game image reject so
// Pixi evicts its failed promise and the map's retry can actually recover.
const mapTextureLoader: LoaderParser<Texture> = {
  id: "tasktopia-map-texture",
  name: "tasktopia-map-texture",
  extension: { type: ExtensionType.LoadParser, priority: 101 },
  test: url => /\/game-assets\/.*\.png(?:[?#]|$)/.test(url),
  async load(url) {
    const image = await loadMapImage(url);
    return new Texture({ source: new ImageSource({ resource: image, scaleMode: "nearest", alphaMode: "premultiply-alpha-on-upload" }), label: url });
  },
  unload: texture => { texture.destroy(true); },
};

extensions.add(mapTextureLoader);
