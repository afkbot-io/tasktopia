import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AuthScreen } from "../src/client/components/AuthScreen";
import { ASSET_REVISION, BUILDING_CATALOG } from "../src/shared/catalog";
import { createAuthScenePlan } from "../src/client/auth-scene-plan";

const publicAssets = resolve("public/game-assets/v5");
const assetPath = (url: string) => url.replace(`/game-assets/v5/revisions/${ASSET_REVISION}/`, "");
describe("authentication scene asset contract", () => {
  it("uses published native scene resources without a map engine or old image fragment", () => {
    const scene=createAuthScenePlan();
    expect(scene.buildings).toHaveLength(7);
    expect(scene.assets.length).toBeLessThanOrEqual(64);
    for(const source of scene.assets){
      expect(source).toContain(`/game-assets/v5/revisions/${ASSET_REVISION}/`);
      expect(existsSync(resolve(publicAssets,assetPath(source))),source).toBe(true);
    }
    const markup=renderToStaticMarkup(<AuthScreen onAuthenticated={async()=>undefined}/>);
    expect(markup).toContain('auth-city-scene');expect(markup).not.toContain('auth-world-building');
  });

  it("keeps native building sizes and anchors on the preview ground", () => {
    const scene=createAuthScenePlan();
    for(const placement of scene.buildings){
      const family=BUILDING_CATALOG.find(b=>b.key===placement.key)!;
      const sprite=scene.sprites.find(s=>s.url===family.stages[placement.stage-1])!;
      expect(sprite.width).toBe(family.spriteSize.width);expect(sprite.height).toBe(family.spriteSize.height);
      expect(sprite.x+family.anchor.x).toBe((placement.x+family.footprint.width/2)*8);
      expect(sprite.y+family.anchor.y).toBe((placement.y+family.footprint.height)*8);
    }
  });

  it("keeps every static client gameAssetUrl reference reachable in the published pack", () => {
    const client = resolve("src/client");
    const missing: string[] = [];
    for (const path of readdirSync(client, { recursive: true })) {
      if (!/\.tsx?$/.test(String(path))) continue;
      const source = readFileSync(resolve(client, String(path)), "utf8");
      for (const [, asset] of source.matchAll(/gameAssetUrl\(["']([^"']+)["']\)/g)) {
        if (!existsSync(resolve(publicAssets, asset!))) missing.push(`${path}: ${asset}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
