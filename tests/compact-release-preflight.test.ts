import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { BLOCK_TEMPLATE_VERSION } from "../src/shared/block-templates";
import { CITY_SCENE_SCHEMA_VERSION } from "../src/shared/city-scene-contract";
import { COUNTRY_OVERVIEW_SCHEMA_VERSION } from "../src/shared/country-overview-contract";
import { COMPACT_BUILDING_SHAPES } from "../src/shared/compact-building-families";

const script = new URL("../deploy/compact-release-preflight.sh", import.meta.url).pathname;
const migrations = ["0023_compact_block_cutover.sql", "0024_dense_slot_planning.sql", "0029_country_road_snapshots.sql"];
const currentCapabilities = {
  blockTemplateVersions: [2, BLOCK_TEMPLATE_VERSION],
  citySceneSchemaVersions: [CITY_SCENE_SCHEMA_VERSION],
  countryOverviewSchemaVersions: [COUNTRY_OVERVIEW_SCHEMA_VERSION],
  countryRoadSnapshotTables: ["country_road_snapshots_v1"],
  blockStructuralShapes: COMPACT_BUILDING_SHAPES,
};
const publicManifest = JSON.parse(readFileSync(new URL("../public/game-assets/v5/manifest.json", import.meta.url), "utf8"));
const buildingFields = ["footprintCells", "spriteSize", "anchorPx", "entrances", "stages"];
const candidateDescriptor = {
  blockStructuralShapes: COMPACT_BUILDING_SHAPES,
  buildings: Object.fromEntries(Object.entries(publicManifest.buildings).map(([key, entry]) => [key,
    Object.fromEntries(buildingFields.map(field => [field, (entry as Record<string, unknown>)[field]]))])),
};

function inspectPrevious(capability: unknown, options: {
  manifest?: typeof publicManifest; candidate?: typeof candidateDescriptor; missingManifest?: boolean; missingStage?: boolean;
} = {}) {
  const program = readFileSync(script, "utf8").match(/--entrypoint node "\$previous_app_image_id" -e '([\s\S]*?)\n {2}'/)![1]!;
  const hash = createHash("sha256").update("migration").digest("hex");
  let output = "";
  runInNewContext(program, {
    require: (name: string) => name === "node:fs" ? {
      readFileSync: (path: string) => {
        if (path === "/app/package.json") return JSON.stringify({ tasktopiaRuntime: capability });
        if (path === "/app/dist/public/game-assets/v5/manifest.json") {
          if (options.missingManifest) throw new Error("missing");
          return JSON.stringify(options.manifest ?? publicManifest);
        }
        if (path.startsWith("/app/migrations/postgres/")) return "migration";
        throw new Error(`Unexpected previous-image path: ${path}`);
      },
      existsSync: (path: string) => !options.missingStage && path.startsWith("/app/dist/public/game-assets/v5/buildings/"),
    } : { createHash },
    process: { argv: ["node", hash, hash, hash, JSON.stringify(options.candidate ?? candidateDescriptor)],
      stdout: { write: (value: string) => { output += value; } } },
  });
  return output;
}

function runPreflight(mode: string, running = false, compatible = true) {
  const root = mkdtempSync(join(tmpdir(), "task14-release-preflight-"));
  try {
    mkdirSync(join(root, "migrations/postgres"), { recursive: true });
    mkdirSync(join(root, "public/game-assets/v5"), { recursive: true });
    copyFileSync(new URL("../package.json", import.meta.url), join(root, "package.json"));
    copyFileSync(new URL("../public/game-assets/v5/manifest.json", import.meta.url), join(root, "public/game-assets/v5/manifest.json"));
    if (mode === "missing_descriptor") rmSync(join(root, "public/game-assets/v5/manifest.json"));
    if (mode === "oversized_descriptor") writeFileSync(join(root, "public/game-assets/v5/manifest.json"), JSON.stringify({
      buildings: Object.fromEntries(Array.from({ length: 129 }, (_, i) => [`family-${i}`, publicManifest.buildings["compact-apartment-v1"]])),
    }));
    const checksums = migrations.map(name => {
      const source = new URL(`../migrations/postgres/${name}`, import.meta.url);
      copyFileSync(source, join(root, "migrations/postgres", name));
      return createHash("sha256").update(readFileSync(source)).digest("hex");
    });
    writeFileSync(join(root, "docker"), `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "$FAKE_CALLS"
if [[ "$1" == run ]]; then printf '%s' "$FAKE_COMPATIBLE"; exit 0; fi
case "$*" in
  *0023_compact_block_cutover.sql*)
    [[ "$FAKE_MODE" != unavailable ]] || exit 8
    [[ "$FAKE_MODE" != pending ]] || exit 0
    [[ "$FAKE_MODE" != checksum ]] || { printf wrong; exit 0; }
    printf '%s' "$FAKE_HASH_23" ;;
  *0024_dense_slot_planning.sql*) printf '%s' "$FAKE_HASH_24" ;;
  *0029_country_road_snapshots.sql*)
    [[ "$FAKE_MODE" != unavailable29 ]] || exit 8
    [[ "$FAKE_MODE" != pending29 ]] || exit 0
    [[ "$FAKE_MODE" != checksum29 ]] || { printf wrong; exit 0; }
    printf '%s' "$FAKE_HASH_29" ;;
  *country_road_snapshots_v1*) [[ "$FAKE_MODE" != incomplete_roads && "$FAKE_MODE" != incomplete ]] || { printf 1; exit 0; }; printf 0 ;;
  *city_layouts_v1*) [[ "$FAKE_MODE" != incomplete ]] || { printf 3; exit 0; }; printf 0 ;;
  *) echo 'Unexpected Docker mutation' >&2; exit 9 ;;
esac
`);
    chmodSync(join(root, "docker"), 0o755);
    writeFileSync(join(root, "calls"), "");
    const result = spawnSync("bash", ["-c", 'set -euo pipefail; source "$1"; check_compact_release_database; check_compact_rollback_image', "bash", script], {
      encoding: "utf8", env: {
        ...process.env, PATH: `${root}:${process.env.PATH}`, APP_DIR: root,
        FAKE_CALLS: join(root, "calls"), FAKE_MODE: mode,
        FAKE_HASH_23: checksums[0], FAKE_HASH_24: checksums[1], FAKE_HASH_29: checksums[2],
        FAKE_COMPATIBLE: compatible ? "compatible" : "incompatible",
        app_was_running: String(running), previous_app_image_id: running ? "sha256:previous" : "",
      },
    });
    return { ...result, calls: readFileSync(join(root, "calls"), "utf8") };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

describe("compact release preflight", () => {
  it("pins package capabilities to the actual block, city and country readers", () => {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(manifest.tasktopiaRuntime).toEqual(currentCapabilities);
  });
  it.each([
    { name: "missing capabilities", capability: undefined, expected: "incompatible" },
    { name: "v2 only", capability: { blockTemplateVersions: [2] }, expected: "incompatible" },
    { name: "v3 without canonical roads", capability: { blockTemplateVersions: [2, 3] }, expected: "incompatible" },
    { name: "old CITY", capability: { ...currentCapabilities, citySceneSchemaVersions: [3] }, expected: "incompatible" },
    { name: "old COUNTRY", capability: { ...currentCapabilities, countryOverviewSchemaVersions: [6] }, expected: "incompatible" },
    { name: "missing snapshot reader", capability: { ...currentCapabilities, countryRoadSnapshotTables: [] }, expected: "incompatible" },
    { name: "current readers", capability: currentCapabilities, expected: "compatible" },
  ])("checks previous-image $name even when migration hashes match", ({ capability, expected }) => {
    expect(inspectPrevious(capability)).toBe(expected);
  });
  it("extracts a bounded geometry descriptor from the actual candidate runtime manifest", () => {
    const descriptor = execFileSync("bash", ["-c", 'source "$1"; compact_release_descriptor', "bash", script], {
      env: { ...process.env, APP_DIR: new URL("..", import.meta.url).pathname }, encoding: "utf8",
    });
    expect(Buffer.byteLength(descriptor)).toBeLessThanOrEqual(65_536);
    expect(JSON.parse(descriptor)).toEqual(candidateDescriptor);
    const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
    expect(dockerfile).toContain("COPY --from=build /app/dist ./dist");
    expect(dockerfile).toContain("COPY --from=build /app/package.json ./package.json");
  });
  it("rejects unknown structural shapes, changed geometry and absent authored families or files", () => {
    const shapes = { ...COMPACT_BUILDING_SHAPES };
    delete (shapes as Partial<typeof shapes>)["compact-u-courtyard-v1"];
    expect(inspectPrevious({ ...currentCapabilities, blockStructuralShapes: shapes })).toBe("incompatible");
    const wrongShape = { ...COMPACT_BUILDING_SHAPES, "compact-apartment-v1": { width: 6, height: 6, floors: 4 } };
    expect(inspectPrevious({ ...currentCapabilities, blockStructuralShapes: wrongShape })).toBe("incompatible");
    const old = structuredClone(publicManifest);
    old.buildings["compact-apartment-v1"].footprintCells = [7, 6];
    expect(inspectPrevious(currentCapabilities, { manifest: old })).toBe("incompatible");
    const added = structuredClone(candidateDescriptor);
    added.buildings["compact-new-family-v1"] = added.buildings["compact-apartment-v1"]!;
    expect(inspectPrevious(currentCapabilities, { candidate: added })).toBe("incompatible");
    expect(inspectPrevious(currentCapabilities, { missingManifest: true })).toBe("incompatible");
    expect(inspectPrevious(currentCapabilities, { missingStage: true })).toBe("incompatible");
  });
  it("does not mistake changed labels or art revision for incompatible geometry", () => {
    const old = structuredClone(publicManifest);
    old.assetRevision = "another-reviewed-palette";
    old.buildings["compact-apartment-v1"].label = "Previous label";
    expect(inspectPrevious(currentCapabilities, { manifest: old })).toBe("compatible");
  });
  it.each(["pending", "checksum", "unavailable", "incomplete", "pending29", "checksum29", "unavailable29", "incomplete_roads"])("fails closed for %s without Docker writes", mode => {
    const result = runPreflight(mode);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Compact cutover");
    expect(result.calls).not.toMatch(/compose (up|build|stop)|pg_dump|docker tag/);
    expect(result.calls).toContain("ON_ERROR_STOP=1");
    expect(result.calls).toContain("statement_timeout=5000");
    expect(result.calls).toContain("default_transaction_read_only=on");
  });
  it("accepts fully regenerated matching geometry with no previous running app", () => {
    const result = runPreflight("ready");
    expect(result.status, result.stderr).toBe(0);
    expect(result.calls).not.toContain("run --rm");
  });
  it("rejects image-only rollback to pre-cutover code", () => {
    const result = runPreflight("ready", true, false);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("previous running image");
    expect(result.calls).toContain("--network none");
  });
  it("allows a checksum-compatible previous image", () => {
    const result = runPreflight("ready", true, true);
    expect(result.status, result.stderr).toBe(0);
  });
  it.each(["missing_descriptor", "oversized_descriptor"])("rejects %s before inspecting the previous image", mode => {
    const result = runPreflight(mode, true);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("candidate geometry descriptor");
    expect(result.calls).not.toContain("run --rm");
  });
  it("runs the fail-closed guard before candidate build and app replacement", () => {
    const updater = readFileSync(new URL("../deploy/update-server.sh", import.meta.url), "utf8");
    const guard = updater.indexOf("check_compact_release_database");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(updater.indexOf("docker compose build --pull app"));
    expect(updater.indexOf("check_compact_rollback_image")).toBeLessThan(updater.indexOf("docker compose build --pull app"));
    expect(() => execFileSync("bash", ["-n", script])).not.toThrow();
  });
});
