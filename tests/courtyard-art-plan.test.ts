import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { getBuilding } from "../src/shared/catalog";
import { isTaskParkVariant } from "../src/shared/task-park-catalog";
import { COURTYARD_ART_FAMILIES, COURTYARD_ART_PARKS, COURTYARD_ART_PLAN, COURTYARD_ART_SERVICE_LIMIT, COURTYARD_ART_MAX_RETRIES, createCourtyardArtWithRetries } from "./fixtures/courtyard-art-plan";

describe("isolated developed courtyard art matrix", () => {
  it("allows three reservation conflicts followed by success, not a fourth connector", async () => {
    const conflict = new Error("reserved service");
    for (const conflicts of [3, 4]) {
      let attempts = 0;
      const connectors: number[] = [];
      const result = createCourtyardArtWithRetries(async () => {
        if (attempts++ < conflicts) throw conflict;
        return "requested case";
      }, error => error === conflict, async retry => { connectors.push(retry); });
      if (conflicts === 3) await expect(result).resolves.toBe("requested case");
      else await expect(result).rejects.toBe(conflict);
      expect(attempts).toBe(4);
      expect(connectors).toEqual([1, 2, 3]);
    }
  });
  it("requests each published family and park at stages3/4/5 without fixed geometry", () => {
    expect(COURTYARD_ART_FAMILIES).toHaveLength(13);
    expect(COURTYARD_ART_PLAN).toHaveLength(48);
    expect(COURTYARD_ART_SERVICE_LIMIT).toBe(24);
    expect(COURTYARD_ART_MAX_RETRIES).toBe(3);
    expect(new Set(COURTYARD_ART_PLAN.map(entry => entry.key)).size).toBe(48);
    expect(getBuilding("compact-long-slate-wing-v1").footprint).toEqual({ width: 6, height: 12 });
    for (const family of COURTYARD_ART_FAMILIES) {
      expect(getBuilding(family).tags).toContain("compact-building");
      expect(COURTYARD_ART_PLAN.filter(entry => entry.family === family).map(entry => entry.stage)).toEqual([3, 4, 5]);
    }
    for (const variant of COURTYARD_ART_PARKS) {
      expect(isTaskParkVariant(variant)).toBe(true);
      expect(COURTYARD_ART_PLAN.filter(entry => entry.parkVariant === variant).map(entry => entry.stage)).toEqual([3, 4, 5]);
    }
    for (const entry of COURTYARD_ART_PLAN) {
      expect(entry).not.toHaveProperty("origin");
      expect(entry).not.toHaveProperty("serviceRole");
    }
  });
  it.each([
    { enabled: "false", url: "postgres://example.invalid/production", message: "Set SEED_COURTYARD_ART_PREVIEW=true" },
    { enabled: "true", url: "postgres://example.invalid/production", message: "Only the unscoped local tasktopia_test URL" },
    { enabled: "true", url: "postgres://tasktopia:tasktopia@127.0.0.1:5432/tasktopia_test?options=-csearch_path%3Dexisting", message: "Only the unscoped local tasktopia_test URL" },
  ])("refuses non-isolated or non-opted-in seed input before any database connection: $enabled $url", ({ enabled, url, message }) => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/seed-courtyard-art-preview.ts"], {
      env: { ...process.env, SEED_COURTYARD_ART_PREVIEW: enabled, TEST_DATABASE_URL: url }, encoding: "utf8", timeout: 10_000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
    expect(result.stderr).not.toContain("New courtyard art schema:");
  });
});
