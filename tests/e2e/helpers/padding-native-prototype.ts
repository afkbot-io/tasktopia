import { Application, Assets, Container, Particle, ParticleContainer, Rectangle, Sprite, Texture } from "pixi.js";
import { atlasTerrainConnectionMask, atlasTerrainKindFromWorld, atlasTerrainTile, type AtlasTerrainKind } from "../../../src/shared/atlas-scene";
import { terrainAt } from "../../../src/shared/world-terrain";
import { cameraTerrainPadding } from "../../../src/client/camera-terrain-padding";

type Rect = { minX: number; minY: number; maxX: number; maxY: number };
type Placement = { x: number; y: number; kind: AtlasTerrainKind; mask: number };
const count = (rect: Rect) => (rect.maxX - rect.minX + 1) * (rect.maxY - rect.minY + 1);
const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * p)]!;

/** Test-only prototype, not loaded by the application or published as a view. */
export async function runPaddingNativePrototype(revision: string) {
  const seed = 424242, scale = .81, width = 1600, height = 2748;
  const position = (x: number) => ({ x: width / 2 - x * 8 * scale, y: height / 2 + 128 * 8 * scale });
  const resident = { minX: -83, minY: -315, maxX: 307, maxY: 3 };
  const before = new Set(cameraTerrainPadding(position(-4.54), scale, { width, height }, resident, 8, 64, 1).map(([x, y]) => `${x},${y}`));
  const after = position(192.99);
  const viewport = { minX: Math.floor(-after.x / (scale * 8)), minY: Math.floor(-after.y / (scale * 8)),
    maxX: Math.ceil((width - after.x) / (scale * 8)) - 1, maxY: Math.ceil((height - after.y) / (scale * 8)) - 1 };
  const strips = cameraTerrainPadding(after, scale, { width, height }, resident, 8, 64)
    .filter(([x, y]) => !before.has(`${x},${y}`)).map(([x, y]) => ({
      minX: Math.max(x * 64, viewport.minX), minY: Math.max(y * 64, viewport.minY),
      maxX: Math.min(x * 64 + 63, viewport.maxX), maxY: Math.min(y * 64 + 63, viewport.maxY),
    }));
  const cases = [
    { name: "small-512", rects: [{ minX: 192, minY: -340, maxX: 223, maxY: -325 }] },
    { name: "medium-2048", rects: [{ minX: 192, minY: -340, maxX: 255, maxY: -309 }] },
    { name: "actual-B-visible-miss", rects: strips },
    { name: "stress-8192", rects: [{ minX: 192, minY: -340, maxX: 319, maxY: -277 }] },
    { name: "stress-16384", rects: [{ minX: 192, minY: -340, maxX: 319, maxY: -213 }] },
  ];
  const kinds: AtlasTerrainKind[] = ["grass", "meadow", "forest", "hill", "mountain", "coast", "river", "stone", "deep_water", "shallow_water"];
  const url = (path: string) => `/game-assets/v5/revisions/${revision}/${path}`;
  await Assets.load(kinds.map(kind => url(atlasTerrainTile(kind, "city", 0, 0, 0).url)));
  for (const kind of kinds) Assets.get<Texture>(url(atlasTerrainTile(kind, "city", 0, 0, 0).url)).source.scaleMode = "nearest";
  const app = new Application();
  await app.init({ width, height, preference: "webgl", resolution: 1, antialias: false, autoStart: false, background: 0x000000 });
  document.body.appendChild(app.canvas);
  app.stage.position.set(after.x, after.y); app.stage.scale.set(scale);
  const textures = new Map<string, Texture>();
  const texture = (cell: Placement) => {
    const tile = atlasTerrainTile(cell.kind, "city", cell.x, cell.y, cell.mask);
    const id = `${tile.url}:${tile.sourceX}:${tile.sourceY}`;
    let value = textures.get(id);
    if (!value) {
      value = new Texture({ source: Assets.get<Texture>(url(tile.url)).source,
        frame: new Rectangle(tile.sourceX, tile.sourceY, tile.tileSize, tile.tileSize) });
      textures.set(id, value);
    }
    return value;
  };
  const reports = [];
  for (const item of cases) {
    const captureTimes: number[] = [], constructSprite: number[] = [], drawSprite: number[] = [], constructParticle: number[] = [], drawParticle: number[] = [];
    let reference: Uint8ClampedArray | undefined, matching = 0, sampled = 0;
    for (let iteration = 0; iteration < 7; iteration++) {
      const at = performance.now();
      const sampledKinds = new Map<string, AtlasTerrainKind>();
      const kindAt = (x: number, y: number) => {
        const id = `${x},${y}`; let kind = sampledKinds.get(id);
        if (!kind) { kind = atlasTerrainKindFromWorld(terrainAt(seed, x, y).terrain); sampledKinds.set(id, kind); }
        return kind;
      };
      const cells: Placement[] = [];
      for (const rect of item.rects) for (let y = rect.minY; y <= rect.maxY; y++) for (let x = rect.minX; x <= rect.maxX; x++) {
        const kind = kindAt(x, y); cells.push({ x, y, kind, mask: atlasTerrainConnectionMask(kind, x, y, kindAt) });
      }
      captureTimes.push(performance.now() - at);
      for (const mode of ["sprite", "particle"] as const) {
        const builtAt = performance.now(); const group = new Container();
        if (mode === "sprite") for (const cell of cells) {
          const view = new Sprite(texture(cell)); view.position.set(cell.x * 8, cell.y * 8); group.addChild(view);
        } else {
          const groups = new Map<string, Particle[]>();
          for (const cell of cells) {
            const key = atlasTerrainTile(cell.kind, "city", cell.x, cell.y, cell.mask).url;
            let particles = groups.get(key); if (!particles) { particles = []; groups.set(key, particles); }
            particles.push(new Particle({ texture: texture(cell), x: cell.x * 8, y: cell.y * 8 }));
          }
          for (const particles of groups.values()) {
            const container = new ParticleContainer({ particles,
              dynamicProperties: { position: false, rotation: false, vertex: false, uvs: false, color: false } });
            // Initial array does not mark static buffers dirty in installed
            // Pixi; explicitly upload static attributes on first draw.
            container.update(); group.addChild(container);
          }
        }
        app.stage.addChild(group); const constructed = performance.now() - builtAt;
        const drawAt = performance.now(); app.render(); const drawn = performance.now() - drawAt;
        (mode === "sprite" ? constructSprite : constructParticle).push(constructed);
        (mode === "sprite" ? drawSprite : drawParticle).push(drawn);
        if (iteration === 6) {
          // Outside timings: readback compares exact pixels between native
          // material approaches, including fractional camera pixel phase.
          const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
          const context = canvas.getContext("2d", { willReadFrequently: true })!; context.drawImage(app.canvas, 0, 0);
          const actual = context.getImageData(0, 0, width, height).data;
          if (mode === "sprite") reference = actual;
          else for (let index = 0; index < actual.length; index += 4) {
            if (reference![index] === 0 && reference![index + 1] === 0 && reference![index + 2] === 0) continue;
            sampled++; if (actual[index] === reference![index] && actual[index + 1] === reference![index + 1] && actual[index + 2] === reference![index + 2]) matching++;
          }
        }
        group.removeFromParent(); group.destroy({ children: true });
      }
    }
    const stats = (values: number[]) => ({ p50: percentile(values, .5), p95: percentile(values, .95), max: Math.max(...values) });
    reports.push({ name: item.name, rects: item.rects, cells: item.rects.reduce((sum, rect) => sum + count(rect), 0),
      captureMs: stats(captureTimes), spriteBuildMs: stats(constructSprite), spriteFirstDrawMs: stats(drawSprite),
      particleBuildMs: stats(constructParticle), particleFirstDrawMs: stats(drawParticle), sampled, matching });
  }
  for (const value of textures.values()) value.destroy(false);
  app.destroy({ removeView: true }, { children: true });
  await Assets.unload(kinds.map(kind => url(atlasTerrainTile(kind, "city", 0, 0, 0).url)));
  return { reports, viewport, beforeCacheChunks: before.size, revision, renderer: "isolated-webgl-prototype", scope: "CPU capture/build/render-call only; not GPU completion or actual CITY input" };
}

Object.assign(window, { runPaddingNativePrototype });
