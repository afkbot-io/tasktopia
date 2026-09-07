import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "../assets/pixel-city-pack/manifest.json";
const root = new URL("../", import.meta.url);
const bytes = (path: string) => readFileSync(new URL(path, root));
const hash = (path: string) => createHash("sha256").update(bytes(path)).digest("hex");

describe("registered AI task-park layers", () => {
  it.each(["fountain", "monument"])("publishes unchanged reviewed %s stages on one native footprint", kind => {
    const family = `assets/pixel-city-pack/reference/ai-authored/compact-park-${kind}-v1`;
    const review = JSON.parse(bytes(`${family}/visual-review.json`).toString());
    const hashes = new Set<string>();
    for (const stage of [3, 4, 5]) {
      const key = `compact-park-${kind}-stage-${stage}`;
      const props = manifest.props as Record<string, { label: string; path: string; size: number[]; footprintCells: number[]; anchorPx: number[]; visualProfile: string }>;
      expect(props[key]).toMatchObject({ label: `${kind === "fountain" ? "Фонтан" : "Памятник"} · стадия ${stage}`,
        size: [16, 16], footprintCells: [2, 2], anchorPx: [8, 16], visualProfile: "TASKTOPIA_COMPACT_PARK_HIGH_45_V1" });
      const accepted = review.stages[String(stage)];
      expect(accepted.accepted).toBe(true);
      expect(hash(`${family}/sources/stage-${stage}.png`)).toBe(accepted.sourceSha256);
      for (const path of [`${family}/normalized/stage-${stage}.png`, `assets/pixel-city-pack/runtime/${props[key]!.path}`, `public/game-assets/v5/${props[key]!.path}`]) {
        expect(hash(path)).toBe(accepted.runtimeSha256);
      }
      hashes.add(accepted.runtimeSha256);
    }
    expect(hashes.size).toBe(3);
  });
});
