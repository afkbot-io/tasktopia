import { Rectangle, Texture } from "pixi.js";

type AtlasFrame = { x: number; y: number; width: number; height: number };

/** Borrow the leased atlas source; callers own only the frame wrapper. */
export function pixelAtlasFrame(atlas: Texture, frame: AtlasFrame): Texture {
  // Subtextures inherit filtering from the shared source, not from their
  // immutable frame. Configure it before the first resident/padding draw.
  atlas.source.scaleMode = "nearest";
  return new Texture({ source: atlas.source,
    frame: new Rectangle(frame.x, frame.y, frame.width, frame.height) });
}
