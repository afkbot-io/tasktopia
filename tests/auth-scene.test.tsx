import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AuthScreen } from "../src/client/components/AuthScreen";
import { ASSET_REVISION, BUILDING_CATALOG, PROP_CATALOG } from "../src/shared/catalog";
import { microAmbientAssetUrls } from "../src/shared/micro-ambient";

const publicAssets = resolve("public/game-assets/v5");
const assetPath = (url: string) => url.replace(`/game-assets/v5/revisions/${ASSET_REVISION}/`, "");
const authImages = () => [...renderToStaticMarkup(<AuthScreen onAuthenticated={async () => undefined} />)
  .matchAll(/<img\b[^>]*data-auth-scene-sprite[^>]*>/g)].map(([tag]) => tag);

describe("authentication scene asset contract", () => {
  it("renders only existing published images, including while bootstrap is pending", () => {
    const images = authImages();
    const published = new Set([
      ...microAmbientAssetUrls(),
      ...BUILDING_CATALOG.flatMap((entry) => entry.stages),
      ...Object.values(PROP_CATALOG).map((entry) => entry.path),
    ]);
    expect(images).toHaveLength(8);
    for (const tag of images) {
      const source = /src="([^"]+)"/.exec(tag)?.[1];
      expect(source, tag).toBeDefined();
      expect(source).toContain(`/game-assets/v5/revisions/${ASSET_REVISION}/`);
      expect(published.has(source!), source).toBe(true);
      expect(existsSync(resolve(publicAssets, assetPath(source!))), source).toBe(true);
    }
  });

  it("uses the catalog's compact stages with integer scaling and an unchanged aspect ratio", () => {
    const images = authImages().filter((tag) => /\/buildings\//.test(tag));
    expect(images).toHaveLength(4);
    const renderedStages = new Set<string>();
    for (const tag of images) {
      const source = /src="([^"]+)"/.exec(tag)![1]!;
      const building = BUILDING_CATALOG.find((entry) => entry.stages.includes(source));
      expect(building, source).toBeDefined();
      expect(building?.tags).toContain("compact-building");
      expect(Number(/\bwidth="(\d+)"/.exec(tag)?.[1])).toBe(building!.spriteSize.width * 2);
      expect(Number(/\bheight="(\d+)"/.exec(tag)?.[1])).toBe(building!.spriteSize.height * 2);
      renderedStages.add(source);
    }
    expect(renderedStages).toEqual(new Set(BUILDING_CATALOG.find(entry => entry.key === "compact-apartment-v1")!.stages.slice(2)));
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
