"""Business-row conservation for the approved compact migration, not a repair."""
import hashlib
import json
import re
import uuid

from compact_cutover_state import canonical, require

SPATIAL_TABLES = {"roads_v3", "world_features_v6", "world_chunk_entities_v11", "world_chunk_district_cells_v1",
                  "world_chunk_payloads_v1", "country_overview_snapshots_v1", "city_layouts_v1", "district_layouts_v1",
                  "city_blocks_v1", "road_networks_v1", "task_placements_v1", "country_road_snapshots_v1"}
EXCLUDE = {
    "countries": ["world_version"],
    "cities_v3": ["center_x", "center_y", "bounds_json"],
    "districts_v3": ["cells_json", "lots_json", "spatial_bounds_json"],
    "tasks_v3": ["origin_x", "origin_y", "footprint_json", "entrance_x", "entrance_y", "access_json", "access_kind",
                 "visual_auto", "requested_building_family", "service_role", "service_trigger", "service_role_assigned",
                 "building_type", "platform_type", "visual_kind", "visual_asset_key"],
}
APPEND_ONLY = {"events", "idempotency", "schema_migrations"}


def project_row(table, row):
    return {key: value for key, value in row.items() if key not in EXCLUDE.get(table, [])}


def capture_business(database, tables=None):
    if tables is None:
        tables = database.json("SELECT COALESCE(jsonb_agg(tablename ORDER BY tablename),'[]') "
                               "FROM pg_tables WHERE schemaname='public'")
        tables = [table for table in tables if table not in SPATIAL_TABLES]
    result = {}
    for table in tables:
        require(re.fullmatch(r"[a-z_][a-z_0-9]*", table), "Invalid conservation table")
        name = "conservation-scan-" + uuid.uuid4().hex
        database.sql('SELECT to_jsonb(t)::text FROM public."' + table + '" t',
                     output_name=name, max_bytes=1024 ** 3)
        hashes = []
        with database.runner.open_private(name) as stream:
            while True:
                line = stream.readline(32 * 1024 ** 2 + 1)
                if not line:
                    break
                require(len(line) <= 32 * 1024 ** 2 and line.endswith(b"\n"), "Oversized conservation row")
                hashes.append(hashlib.sha256(canonical(project_row(table, json.loads(line)))).hexdigest())
        (database.runner.directory / name).unlink()
        result[table] = sorted(hashes)
    return result


def verify_business(before, after):
    require(set(before) == set(after), "Business table disappeared")
    for table, hashes in before.items():
        if table in APPEND_ONLY:
            # Multiplicity as well as identity must survive.
            from collections import Counter
            require(not (Counter(hashes) - Counter(after[table])), "A preexisting audit or receipt row changed")
        else:
            require(after[table] == hashes, "Business rows changed in " + table)
    return {"tables": len(before), "rowsPreserved": sum(map(len, before.values()))}
