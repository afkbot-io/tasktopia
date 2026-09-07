#!/usr/bin/env bash
# Read-only gates for the destructive compact cutover. Sourced by the updater.
# Deliberately no bypass flag: first cutover requires the maintenance runbook.

compact_migration_checksum() {
  openssl dgst -sha256 "$APP_DIR/migrations/postgres/$1" | awk '{ print $NF }'
}

compact_release_query() {
  docker compose exec -T postgres env \
    PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000' \
    psql -X -At -U tasktopia -d tasktopia -v ON_ERROR_STOP=1 -c "$1"
}

check_compact_release_database() {
  local migration expected actual missing
  for migration in 0023_compact_block_cutover.sql 0024_dense_slot_planning.sql 0029_country_road_snapshots.sql; do
    expected="$(compact_migration_checksum "$migration")"
    if [[ ! "$expected" =~ ^[a-f0-9]{64}$ ]]; then
      echo "Compact cutover: unable to hash candidate migration $migration" >&2
      return 1
    fi
    if ! actual="$(compact_release_query "SELECT checksum FROM schema_migrations WHERE name='$migration'")" \
      || [[ "$actual" != "$expected" ]]; then
      echo "Compact cutover: $migration is pending, mismatched or unreadable. Ordinary image-only update is unsafe. Follow docs/COMPACT-BLOCK-CUTOVER.md with traffic paused and a verified pre-cutover restore point." >&2
      return 1
    fi
  done
  # Reader readiness only: inspect compressed records, never rasterize/search
  # or repair them. Empty worlds may have no snapshot; a developed country must
  # have one, even when its valid plan has no accepted routes. This does not
  # certify topology freshness/terrain or the old hard-halo contents: the
  # maintenance FORCE=1 replay and complete world audit are separate gates.
  if ! missing="$(compact_release_query "SELECT
    (SELECT count(*) FROM cities_v3 c WHERE NOT EXISTS (
      SELECT 1 FROM city_layouts_v1 l WHERE l.city_id=c.id AND l.status='ACTIVE')) +
    (SELECT count(*) FROM tasks_v3 t WHERE NOT EXISTS (
      SELECT 1 FROM task_placements_v1 p JOIN city_layouts_v1 l ON l.id=p.layout_id
      WHERE p.task_id=t.id AND l.city_id=t.city_id AND l.status='ACTIVE')) +
    (SELECT count(*) FROM city_blocks_v1 b JOIN city_layouts_v1 l ON l.id=b.layout_id
      WHERE l.status='ACTIVE' AND (b.template_version NOT IN (2,3)
        OR (b.template_version=2 AND jsonb_exists(b.parameters_json, 'sitePlan'))
        OR (b.template_version=3 AND (
          b.parameters_json->'sitePlan'->'version' IS DISTINCT FROM '1'::jsonb
          OR CASE WHEN jsonb_typeof(b.parameters_json->'sitePlan'->'parcels')='array'
            THEN jsonb_array_length(b.parameters_json->'sitePlan'->'parcels') NOT BETWEEN 1 AND b.width*b.height ELSE true END
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(b.parameters_json->'sitePlan'->'parcels')='array'
            THEN b.parameters_json->'sitePlan'->'parcels' ELSE '[]'::jsonb END) parcel
            WHERE EXISTS (SELECT 1 FROM (VALUES ('x'), ('y'), ('width'), ('height')) coordinate(key)
              WHERE jsonb_typeof(parcel->coordinate.key) IS DISTINCT FROM 'number'
                OR COALESCE(parcel->>coordinate.key, '') !~ '^[0-9]+$')
              OR (parcel->'clearance' IS DISTINCT FROM '0'::jsonb AND parcel->'clearance' IS DISTINCT FROM '1'::jsonb)
              OR COALESCE(parcel->>'kind', '') NOT IN ('BUILDING', 'PARK', 'WATER', 'PARKING')
              OR (parcel->>'kind'='BUILDING' AND (parcel->'clearance' IS DISTINCT FROM '1'::jsonb
                OR jsonb_typeof(parcel->'family') IS DISTINCT FROM 'string' OR COALESCE(parcel->>'family', '')=''))
              OR (parcel->>'kind'<>'BUILDING' AND jsonb_exists(parcel, 'family'))
              OR CASE WHEN jsonb_typeof(parcel->'x')='number' AND jsonb_typeof(parcel->'y')='number'
                AND jsonb_typeof(parcel->'width')='number' AND jsonb_typeof(parcel->'height')='number'
                AND jsonb_typeof(parcel->'clearance')='number'
                THEN (parcel->>'x')::numeric<3 OR (parcel->>'y')::numeric<3
                  OR (parcel->>'width')::numeric<1 OR (parcel->>'height')::numeric<1
                  OR (parcel->>'x')::numeric+(parcel->>'width')::numeric+2*(parcel->>'clearance')::numeric>b.width-2
                  OR (parcel->>'y')::numeric+(parcel->>'height')::numeric+2*(parcel->>'clearance')::numeric>b.height-2
                ELSE false END))))) +
    (SELECT count(*) FROM city_layouts_v1 l WHERE l.status='ACTIVE' AND NOT EXISTS (
      SELECT 1 FROM road_networks_v1 r WHERE r.layout_id=l.id)) +
    (SELECT count(*) FROM countries c LEFT JOIN country_road_snapshots_v1 s ON s.country_id=c.id
      WHERE (s.country_id IS NOT NULL OR EXISTS (
        SELECT 1 FROM city_layouts_v1 l JOIN city_blocks_v1 b ON b.layout_id=l.id
        WHERE l.country_id=c.id AND l.status='ACTIVE')) AND (
        s.country_id IS NULL
        OR s.plan_json->'countryId' IS DISTINCT FROM to_jsonb(c.id)
        OR s.plan_json->'seed' IS DISTINCT FROM to_jsonb(c.seed)
        OR jsonb_typeof(s.plan_json->'routes') IS DISTINCT FROM 'array'
        OR CASE WHEN jsonb_typeof(s.plan_json->'routes')='array'
          THEN jsonb_array_length(s.plan_json->'routes')>100 ELSE false END
        OR jsonb_typeof(s.plan_json->'unreachable') IS DISTINCT FROM 'array'
        OR jsonb_typeof(s.plan_json->'components') IS DISTINCT FROM 'array'
        OR jsonb_typeof(s.plan_json->'metrics') IS DISTINCT FROM 'object'
        OR EXISTS (SELECT 1 FROM (VALUES ('candidates'), ('attemptedRoutes'), ('retainedRoutes'),
          ('visited'), ('terrainSamples'), ('edgeChecks')) required(key)
          WHERE jsonb_typeof(s.plan_json->'metrics'->required.key) IS DISTINCT FROM 'number'
            OR COALESCE(s.plan_json->'metrics'->>required.key, '') !~ '^[0-9]+$')
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.plan_json->'components')='array'
          THEN s.plan_json->'components' ELSE '[]'::jsonb END) component
          WHERE jsonb_typeof(component) IS DISTINCT FROM 'array'
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(component)='array'
              THEN component ELSE '[]'::jsonb END) city
              WHERE jsonb_typeof(city) IS DISTINCT FROM 'string' OR city=to_jsonb(''::text)))
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.plan_json->'unreachable')='array'
          THEN s.plan_json->'unreachable' ELSE '[]'::jsonb END) failure
          WHERE jsonb_typeof(failure->'fromCityId') IS DISTINCT FROM 'string'
            OR COALESCE(failure->>'fromCityId', '')=''
            OR jsonb_typeof(failure->'toCityId') IS DISTINCT FROM 'string'
            OR COALESCE(failure->>'toCityId', '')=''
            OR COALESCE(failure->>'reason', '') NOT IN ('NO_ENDPOINT', 'NO_PATH', 'ROUTE_BUDGET', 'TOTAL_BUDGET'))
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.plan_json->'routes')='array'
          THEN s.plan_json->'routes' ELSE '[]'::jsonb END) route
          WHERE route->'widthCells' IS DISTINCT FROM '3'::jsonb
            OR EXISTS (SELECT 1 FROM (VALUES ('id'), ('fromCityId'), ('toCityId'), ('fromNodeId'), ('toNodeId')) required(key)
              WHERE jsonb_typeof(route->required.key) IS DISTINCT FROM 'string'
                OR COALESCE(route->>required.key, '')='')
            OR route->>'fromCityId'=route->>'toCityId'
            OR EXISTS (SELECT 1 FROM (VALUES ('x'), ('y')) coordinate(key)
              WHERE jsonb_typeof(route->'geometry'->'start'->coordinate.key) IS DISTINCT FROM 'number'
                OR COALESCE(route->'geometry'->'start'->>coordinate.key, '') !~ '^(-[0-9]+|[0-9]+)$'
                OR CASE WHEN jsonb_typeof(route->'geometry'->'start'->coordinate.key)='number'
                  THEN abs((route->'geometry'->'start'->>coordinate.key)::numeric)>9007199254740991 ELSE false END)
            OR CASE WHEN jsonb_typeof(route->'geometry'->'runs')='array'
              THEN jsonb_array_length(route->'geometry'->'runs')=0 ELSE true END
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(route->'geometry'->'runs')='array'
              THEN route->'geometry'->'runs' ELSE '[]'::jsonb END) run
              WHERE COALESCE(run->>'direction', '') NOT IN ('N', 'E', 'S', 'W')
                OR jsonb_typeof(run->'length') IS DISTINCT FROM 'number'
                OR COALESCE(run->>'length', '') !~ '^[1-9][0-9]*$'
                OR CASE WHEN jsonb_typeof(run->'length')='number'
                  THEN (run->>'length')::numeric>9007199254740991 ELSE false END))));")" \
    || [[ "$missing" != 0 ]]; then
    echo "Compact cutover: missing/incompatible layouts, task placements, road networks or canonical country-road snapshots. Complete regeneration and conservation/world audits before reopening traffic." >&2
    return 1
  fi
}

compact_release_descriptor() {
  # python3 is already an updater dependency. Avoid putting the full asset
  # manifest (currently >128KiB) in one Linux argv item. No paths or secrets
  # outside the candidate's public registry/package are read.
  python3 - "$APP_DIR/package.json" "$APP_DIR/public/game-assets/v5/manifest.json" <<'PY'
import json
import sys

def read_json(path, limit):
    with open(path, encoding="utf-8") as source:
        text = source.read(limit + 1)
    if len(text.encode("utf-8")) > limit:
        raise ValueError("Candidate descriptor source exceeds byte budget")
    return json.loads(text)

package = read_json(sys.argv[1], 65536)
manifest = read_json(sys.argv[2], 4 * 1024 * 1024)
shapes = package["tasktopiaRuntime"]["blockStructuralShapes"]
buildings = manifest["buildings"]
if not isinstance(shapes, dict) or not 1 <= len(shapes) <= 128 or not isinstance(buildings, dict) or not 1 <= len(buildings) <= 128:
    raise ValueError("Missing or oversized candidate geometry registry")
fields = ("footprintCells", "spriteSize", "anchorPx", "entrances", "stages")
descriptor = json.dumps({"blockStructuralShapes": shapes,
    "buildings": {key: {field: entry[field] for field in fields} for key, entry in buildings.items()}},
    ensure_ascii=True, separators=(",", ":"))
if len(descriptor.encode("utf-8")) > 65536:
    raise ValueError("Candidate geometry descriptor exceeds 64KiB")
sys.stdout.write(descriptor)
PY
}

check_compact_rollback_image() {
  [[ "$app_was_running" == true && -n "$previous_app_image_id" ]] || return 0
  local compatible descriptor
  if ! descriptor="$(compact_release_descriptor)"; then
    echo "Compact cutover: candidate geometry descriptor is missing/invalid; automatic image rollback cannot be proven safe." >&2
    return 1
  fi
  # Inspect image files in an isolated container: no DB/network, mounts or
  # application startup. Matching contract migrations are a prerequisite for
  # this updater's automatic image rollback, not permission for a DB rollback.
  if ! compatible="$(docker run --rm --network none --entrypoint node "$previous_app_image_id" -e '
    const fs = require("node:fs"), crypto = require("node:crypto");
    const names = ["0023_compact_block_cutover.sql", "0024_dense_slot_planning.sql", "0029_country_road_snapshots.sql"];
    const ok = names.every((name, i) => {
      try { return crypto.createHash("sha256").update(fs.readFileSync("/app/migrations/postgres/" + name)).digest("hex") === process.argv[i + 1]; }
      catch { return false; }
    });
    let supportsReaders = false, supportsGeometry = false;
    try {
      const capability = JSON.parse(fs.readFileSync("/app/package.json", "utf8")).tasktopiaRuntime;
      const includes = (key, values) => Array.isArray(capability?.[key]) && values.every(value => capability[key].includes(value));
      supportsReaders = includes("blockTemplateVersions", [2, 3])
        && includes("citySceneSchemaVersions", [4])
        && includes("countryOverviewSchemaVersions", [7])
        && includes("countryRoadSnapshotTables", ["country_road_snapshots_v1"]);
      const candidate = JSON.parse(process.argv[4]);
      const manifest = JSON.parse(fs.readFileSync("/app/dist/public/game-assets/v5/manifest.json", "utf8"));
      const record = value => value && typeof value === "object" && !Array.isArray(value);
      const normalized = value => Array.isArray(value) ? value.map(normalized)
        : record(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalized(item)])) : value;
      const equal = (a, b) => JSON.stringify(normalized(a)) === JSON.stringify(normalized(b));
      const integer = value => Number.isSafeInteger(value) && value >= 0;
      const pair = (value, positive) => Array.isArray(value) && value.length === 2 && value.every(n => integer(n) && (!positive || n > 0));
      const shape = value => record(value) && ["width", "height", "floors"].every(key => integer(value[key]) && value[key] > 0);
      const path = value => typeof value === "string" && /^buildings\/[a-z0-9/_-]+[.]png$/.test(value);
      const building = entry => record(entry) && pair(entry.footprintCells, true) && pair(entry.spriteSize, true)
        && pair(entry.anchorPx, false) && entry.anchorPx.every((n, i) => n <= entry.spriteSize[i])
        && Array.isArray(entry.entrances) && entry.entrances.length > 0 && entry.entrances.length <= 4
        && entry.entrances.every(entrance => record(entrance) && ["N", "E", "S", "W"].includes(entrance.side) && integer(entrance.offset))
        && Array.isArray(entry.stages) && entry.stages.length === 5 && new Set(entry.stages).size === 5 && entry.stages.every(path);
      const fields = ["footprintCells", "spriteSize", "anchorPx", "entrances", "stages"];
      supportsGeometry = record(candidate.blockStructuralShapes) && record(capability?.blockStructuralShapes)
        && Object.keys(candidate.blockStructuralShapes).length > 0 && Object.keys(candidate.blockStructuralShapes).length <= 128
        && Object.entries(candidate.blockStructuralShapes).every(([key, value]) => shape(value) && equal(value, capability.blockStructuralShapes[key]))
        && record(candidate.buildings) && record(manifest.buildings)
        && Object.keys(candidate.buildings).length > 0 && Object.keys(candidate.buildings).length <= 128
        && Object.entries(candidate.buildings).every(([key, entry]) => building(entry) && building(manifest.buildings[key])
          && fields.every(field => equal(entry[field], manifest.buildings[key][field]))
          && entry.stages.every(stage => fs.existsSync("/app/dist/public/game-assets/v5/" + stage)));
    } catch { /* Missing capability is not evidence of a compatible reader. */ }
    process.stdout.write(ok && supportsReaders && supportsGeometry ? "compatible" : "incompatible");
  ' "$(compact_migration_checksum 0023_compact_block_cutover.sql)" \
    "$(compact_migration_checksum 0024_dense_slot_planning.sql)" \
    "$(compact_migration_checksum 0029_country_road_snapshots.sql)" "$descriptor")" \
    || [[ "$compatible" != compatible ]]; then
    echo "Compact cutover: previous running image cannot read this schema, template-v3 plans, geometry/family registry or CITY4/COUNTRY7 canonical roads; automatic image rollback is unsafe. Use the authorized maintenance cutover, never restart old code against the new database." >&2
    return 1
  fi
}
