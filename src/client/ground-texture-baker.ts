import { Container, type GenerateTextureOptions, type Renderer } from "pixi.js";

/** Owns disposable source geometry; returned render textures belong to callers. */
export class GroundTextureBaker {
  // Pixi keeps batchers by root instruction-set uid for the renderer lifetime.
  // Reusing this root bounds that cache without touching private engine state.
  private readonly root = new Container({ isRenderGroup: true, eventMode: "none", label: "ground-bake-root" });
  constructor(private readonly renderer: Pick<Renderer, "textureGenerator">) {}
  bake(source: Container, options: Omit<GenerateTextureOptions, "target">) {
    if (this.root.destroyed) throw new Error("Ground texture baker is disposed");
    if (source.parent) throw new Error("Ground bake source must be detached from the live world");
    this.root.addChild(source);
    try { return this.renderer.textureGenerator.generateTexture({ ...options, target: this.root }); }
    finally { source.removeFromParent(); source.destroy({ children: true }); }
  }
  destroy(): void { this.root.destroy({ children: true }); }
}
