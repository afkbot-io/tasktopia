import { Container, Rectangle, Texture, type Renderer } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { GroundTextureBaker } from "../src/client/ground-texture-baker";

describe("ground bake renderer ownership", () => {
  it("reuses one renderer-owned instruction root while destroying each temporary source", () => {
    const roots = new Set<Container>(), sources: Container[] = [];
    const generateTexture = vi.fn(options => {
      roots.add(options.target);
      expect(options.target.children).toHaveLength(1);
      expect(options.textureSourceOptions.scaleMode).toBe("nearest");
      return Texture.EMPTY;
    });
    const baker = new GroundTextureBaker({ textureGenerator: { generateTexture } } as unknown as Renderer);
    for (let n = 0; n < 12; n++) {
      const source = new Container(); source.addChild(new Container()); sources.push(source);
      baker.bake(source, { frame: new Rectangle(0, 0, 8, 8), textureSourceOptions: { scaleMode: "nearest" } });
      expect(source.destroyed).toBe(true);
    }
    expect(roots.size).toBe(1);
    expect([...roots][0]!.destroyed).toBe(false);
    expect([...roots][0]!.children).toHaveLength(0);
    baker.destroy(); expect([...roots][0]!.destroyed).toBe(true);
    expect(sources.every(source => source.destroyed)).toBe(true);
  });
  it("detaches and destroys failed work without poisoning the next bake", () => {
    let root: Container | undefined;
    const generateTexture = vi.fn(options => { root = options.target; throw new Error("GPU failed"); });
    const baker = new GroundTextureBaker({ textureGenerator: { generateTexture } } as unknown as Renderer);
    const source = new Container();
    expect(() => baker.bake(source, {})).toThrow("GPU failed");
    expect(source.destroyed).toBe(true); expect(root!.children).toHaveLength(0);
    expect(root!.destroyed).toBe(false); baker.destroy();
  });
  it("does not steal a live-world child", () => {
    const generateTexture = vi.fn(), world = new Container(), source = new Container(); world.addChild(source);
    const baker = new GroundTextureBaker({ textureGenerator: { generateTexture } } as unknown as Renderer);
    expect(() => baker.bake(source, {})).toThrow("detached");
    expect(source.parent).toBe(world); expect(source.destroyed).toBe(false); expect(generateTexture).not.toHaveBeenCalled();
    baker.destroy(); world.destroy({ children: true });
  });
});
