import { Application, Container, Rectangle, Sprite, Texture } from "pixi.js";
import { GroundTextureBaker } from "../../../src/client/ground-texture-baker";

/** Installed-engine regression; private cache is observed, never modified. */
export async function runGroundBakeCache() {
  const cases = [];
  for (const reusable of [false, true]) {
    const app = new Application(); await app.init({ width: 256, height: 256, preference: "webgl", autoStart: false, antialias: false });
    const baker = new GroundTextureBaker(app.renderer);
    const counts: number[] = [], pixels: number[][] = [], sourceStates: boolean[] = [];
    for (let iteration = 0; iteration < 12; iteration++) {
      const source = new Container(), color = iteration % 2 ? 0x336699 : 0x996633;
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
        const view = new Sprite(Texture.WHITE); view.position.set(x * 8, y * 8); view.width = 8; view.height = 8; view.tint = color; source.addChild(view);
      }
      const options = { frame: new Rectangle(0, 0, 256, 256), textureSourceOptions: { scaleMode: "nearest" as const }, antialias: false };
      const texture = reusable ? baker.bake(source, options) : app.renderer.textureGenerator.generateTexture({ ...options, target: source });
      if (!reusable) source.destroy({ children: true });
      sourceStates.push(source.destroyed);
      const extracted = app.renderer.extract.pixels({ target: texture });
      pixels.push([...extracted.pixels.slice(0, 4)]); texture.destroy(true);
      const batch = app.renderer.renderPipes.batch as unknown as { _batchersByInstructionSet: Record<string, unknown> };
      counts.push(Object.keys(batch._batchersByInstructionSet).length);
    }
    cases.push({ reusable, counts, pixels, sourceStates }); baker.destroy(); app.destroy(true, { children: true });
  }
  return cases;
}
(window as typeof window & { runGroundBakeCache: typeof runGroundBakeCache }).runGroundBakeCache = runGroundBakeCache;
