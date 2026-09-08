import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../assets/pixel-city-pack/manifest.json";

describe("moving-agent runtime asset audit", () => {
  it("keeps the reviewed micro family crisp, top-down and free of gait frames", () => {
    const output = execFileSync(
      process.env.ASSET_PYTHON ?? resolve(".venv-assets/bin/python"),
      ["scripts/verify-micro-ambient.py"],
      { encoding: "utf8" },
    );
    expect(JSON.parse(output)).toMatchObject({ sprites: 76, valid: true, errors: [] });
  });

  it("rejects hidden legacy fallback families and an invented animal animation frame", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "tasktopia-micro-audit-test-"));
    try {
      const changed = structuredClone(manifest);
      changed.microAmbient.sprites["micro-animal-fox-north"].frameCount = 3;
      const path = resolve(directory, "manifest.json");
      writeFileSync(path, JSON.stringify({ ...changed, vehicles: {} }));
      expect(() => execFileSync(
        process.env.ASSET_PYTHON ?? resolve(".venv-assets/bin/python"),
        ["scripts/verify-micro-ambient.py", "--manifest", path],
        { encoding: "utf8", stdio: "pipe" },
      )).toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
