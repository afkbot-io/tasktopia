import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../assets/pixel-city-pack/micro-ambient-manifest.json";
import { MICRO_ANIMAL_SPECIES, MICRO_CAR_VARIANTS, MICRO_DIRECTIONS, MICRO_PERSON_VARIANTS, microAmbientAssetUrls, microAmbientSprite, microDirection } from "../src/shared/micro-ambient";

const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

describe("native top-down micro ambient", () => {
  it("uses separately authored directions at native size without runtime scaling", () => {
    for (const [kind, variants, size] of [["car", MICRO_CAR_VARIANTS, 8], ["person", MICRO_PERSON_VARIANTS, 8], ["aircraft", ["regional"], 16]] as const) {
      for (const variant of variants) {
        const urls = MICRO_DIRECTIONS.map((direction) => {
          const sprite = microAmbientSprite(kind, variant, direction);
          expect(sprite).toMatchObject({ direction, width: size, height: size, anchor: { x: size / 2, y: size / 2 }, frameCount: 1 });
          const width = sprite.opaqueBounds.right - sprite.opaqueBounds.left;
          const height = sprite.opaqueBounds.bottom - sprite.opaqueBounds.top;
          expect(width).toBeLessThanOrEqual(kind === "aircraft" ? 12 : kind === "person" ? 3 : ["north", "south"].includes(direction) ? 4 : 6);
          expect(height).toBeLessThanOrEqual(kind === "aircraft" ? 12 : kind === "person" ? 4 : ["north", "south"].includes(direction) ? 6 : 4);
          return sprite.url;
        });
        expect(new Set(urls).size).toBe(4);
      }
    }
  });

  it("has one static pose per animal with no hidden walk frames", () => {
    for (const species of MICRO_ANIMAL_SPECIES) {
      const sprites = MICRO_DIRECTIONS.map((direction) => microAmbientSprite("animal", species, direction));
      expect(new Set(sprites.map((sprite) => sprite.url)).size).toBe(1);
      expect(sprites[0]).toMatchObject({ direction: "static", width: 8, height: 8, frameCount: 1 });
    }
    expect(Object.keys(manifest.sprites).filter((key) => key.startsWith("micro-animal-"))).toHaveLength(8);
  });

  it("maps compass directions explicitly and rejects unpublished variants", () => {
    const current = { x: 2, y: 2 };
    expect(microDirection(current, { x: 2, y: 1 })).toBe("north");
    expect(microDirection(current, { x: 3, y: 2 })).toBe("east");
    expect(microDirection(current, { x: 2, y: 3 })).toBe("south");
    expect(microDirection(current, { x: 1, y: 2 })).toBe("west");
    expect(() => microAmbientSprite("car", "legacy-giant")).toThrow("Unknown micro ambient sprite");
  });

  it("keeps a stopped heading and chooses the dominant axis for a flight tangent", () => {
    expect(microDirection({ x: 1, y: 1 }, { x: 1, y: 1 }, "west")).toBe("west");
    expect(microDirection({ x: 0, y: 0 }, { x: .1, y: -.9 })).toBe("north");
    expect(microDirection({ x: 0, y: 0 }, { x: -.1, y: .9 })).toBe("south");
  });

  it("publishes every preload from pinned new source sheets and identical runtime/public bytes", () => {
    expect(microAmbientAssetUrls()).toHaveLength(36);
    expect(new Set(microAmbientAssetUrls()).size).toBe(36);
    for (const source of Object.values(manifest.sources)) {
      expect(sha(resolve("assets/pixel-city-pack", source.path))).toBe(source.sha256);
    }
    for (const sprite of Object.values(manifest.sprites)) {
      for (const base of ["assets/pixel-city-pack/runtime", "public/game-assets/v5"]) {
        const path = resolve(base, sprite.path);
        expect(existsSync(path)).toBe(true);
        expect(sha(path)).toBe(sprite.sha256);
        const png = readFileSync(path);
        expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual(sprite.size);
      }
    }
  });
});
