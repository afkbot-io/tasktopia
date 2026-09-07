import { Texture, TextureSource } from "pixi.js";
import { describe, expect, it } from "vitest";
import { pixelAtlasFrame } from "../src/client/pixel-atlas-frame";

describe("native prop atlas sampling", () => {
  it("uses nearest filtering on the actual shared Pixi source before either prop frame is rendered", () => {
    const source = new TextureSource({ width: 512, height: 128, scaleMode: "linear" });
    const atlas = new Texture({ source });
    const rack = pixelAtlasFrame(atlas, { x: 18, y: 68, width: 16, height: 8 });
    const tree = pixelAtlasFrame(atlas, { x: 40, y: 68, width: 24, height: 24 });
    expect(rack.source).toBe(source);
    expect(tree.source).toBe(source);
    expect(rack.source.style.scaleMode).toBe("nearest");
    expect(tree.source.style.scaleMode).toBe("nearest");
    expect(rack.frame).toMatchObject({ x: 18, y: 68, width: 16, height: 8 });
    rack.destroy(false); tree.destroy(false); atlas.destroy(true);
  });

  it("frame disposal never destroys the leased shared source or another live frame", () => {
    const source = new TextureSource({ width: 512, height: 128 });
    const atlas = new Texture({ source });
    const day = pixelAtlasFrame(atlas, { x: 1, y: 1, width: 8, height: 16 });
    const night = pixelAtlasFrame(atlas, { x: 10, y: 1, width: 8, height: 16 });
    day.destroy(false);
    expect(day.destroyed).toBe(true);
    expect(source.destroyed).toBe(false);
    expect(night.destroyed).toBe(false);
    expect(night.source).toBe(atlas.source);
    night.destroy(false); atlas.destroy(true);
  });
});
