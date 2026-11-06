"""Opt-in derived preparation inside the frozen, backed-up managed cutover.

No deployment commands or credentials here. The host driver owns the exact
image, fixed CLI allowlist, private output and deadline for every invocation.
"""
from collections import Counter
import json
import re
import time

from compact_cutover_conservation import capture_rows
from compact_cutover_state import canonical, require

DERIVED_TABLES = frozenset({"world_chunk_payloads_v1", "country_overview_snapshots_v1",
                          "city_scene_snapshots_v1", "country_road_snapshots_v1", "country_transport_networks_v1"})
APPEND_PLANS = frozenset({"city_airport_sites_v1", "city_railway_corridors_v1", "city_transit_stop_plans_v1"})
ENTRIES = ("synchronize-transport", "synchronize-roads", "synchronize-city-scenes")
UUID = re.compile(r"[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}")
SHA = re.compile(r"[a-f0-9]{64}")
DEADLINE_SECONDS = 1800


def integer(value, minimum=0, maximum=2 ** 53 - 1):
    return type(value) is int and minimum <= value <= maximum


def uuid(value):
    return isinstance(value, str) and UUID.fullmatch(value) is not None


def sha(value):
    return isinstance(value, str) and SHA.fullmatch(value) is not None


def capture_sources(database):
    tables = database.json("SELECT COALESCE(jsonb_agg(tablename ORDER BY tablename),'[]') "
                           "FROM pg_tables WHERE schemaname='public'")
    require(isinstance(tables, list), "Invalid living-city source catalog")
    # The preceding migration check already preserved every preexisting field.
    # Only this explicit phase may publish a new country world version.
    return capture_rows(database, [name for name in tables if name not in DERIVED_TABLES],
                        lambda table, row: {key: value for key, value in row.items()
                                            if not (table == "countries" and key == "world_version")})


def verify_sources(before, after):
    require(set(before) == set(after), "Living-city source catalog changed")
    for table, rows in before.items():
        if table in APPEND_PLANS:
            require(not (Counter(rows) - Counter(after[table])), "Existing frozen plan changed: " + table)
        else:
            # Unlike the migration phase, task/audit/idempotency writes are not
            # expected here. Even a new event or work row is a failed release.
            require(rows == after[table], "Living-city source rows changed: " + table)
    return {"tables": len(before), "rowsPreserved": sum(map(len, before.values()))}


def road_routes(database):
    rows = database.json("SELECT COALESCE(jsonb_agg(jsonb_build_object('countryId',country_id,"
                         "'routes',plan_json->'routes') ORDER BY country_id),'[]') FROM country_road_snapshots_v1")
    require(isinstance(rows, list), "Invalid retained road catalog")
    result = {}
    for row in rows:
        require(isinstance(row, dict) and uuid(row.get("countryId")) and isinstance(row.get("routes"), list),
                "Invalid retained road owner")
        for route in row["routes"]:
            require(isinstance(route, dict) and isinstance(route.get("id"), str) and route["id"], "Invalid retained road")
            key = (row["countryId"], route["id"])
            require(key not in result, "Duplicate accepted road")
            result[key] = canonical(route)
    return result


def state_digest(database, country_id):
    """Compare preview/repeat including publication versions and cache bodies.

    PostgreSQL hashes rows locally: blobs, credentials and raw task contents
    never enter the operator's receipt. Scope uses a validated authority UUID.
    """
    require(uuid(country_id), "Invalid state digest scope")
    fields = []
    for table in sorted(DERIVED_TABLES | APPEND_PLANS | {"countries"}):
        where = ("id='" + country_id + "'" if table == "countries" else
                 "layout_id IN (SELECT id FROM city_layouts_v1 WHERE country_id='" + country_id + "')"
                 if table in APPEND_PLANS else "country_id='" + country_id + "'")
        fields.append("'" + table + "',(SELECT COALESCE(jsonb_agg(h ORDER BY h),'[]') FROM "
                      "(SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS h FROM "
                      + table + " t WHERE " + where + ") s)")
    return database.json("SELECT jsonb_build_object(" + ",".join(fields) + ")")


def validate_receipt(output, entry, country_id, write):
    require(entry in ENTRIES and uuid(country_id) and type(write) is bool, "Unplanned living-city command")
    try:
        value = json.loads(output)
    except (ValueError, TypeError, UnicodeError):
        require(False, "Invalid living-city CLI output")
    require(isinstance(value, dict) and value.get("countryId") == country_id
            and value.get("mode") == ("write" if write else "dry-run"), "Wrong living-city CLI scope/mode")
    if entry == "synchronize-transport":
        stops = value.get("transitStops")
        require(value.get("event") == "transport.synchronization" and isinstance(stops, dict)
                and all(integer(stops.get(k)) for k in ("readyBefore", "readyAfter", "cities", "previewPlans", "stops", "changedPlans"))
                and sha(stops.get("checksum")), "Invalid transport preparation receipt")
        if write:
            require(stops["readyAfter"] == stops["cities"], "Transit stop plans are not ready")
        else:
            require(stops["changedPlans"] == 0 and stops["readyAfter"] == stops["readyBefore"],
                    "Transit preview claimed writes")
        return {"stops": stops}
    if entry == "synchronize-roads":
        after = value.get("after")
        require(value.get("event") == "roads.synchronization" and type(value.get("changed")) is bool
                and isinstance(after, dict) and type(after.get("plannerVersion")) is int and after["plannerVersion"] == 4
                and integer(after.get("revision"), 1) and integer(after.get("routes"), 0, 100)
                and sha(value.get("checksum")), "Invalid road preparation receipt")
        return {"changed": value["changed"], "after": after, "checksum": value["checksum"]}
    rows = value.get("rows")
    require(value.get("event") == "city-scenes.synchronization" and isinstance(rows, list)
            and integer(value.get("cities"), 0, 10000) and value["cities"] == len(rows)
            and integer(value.get("ready"), 0, len(rows)) and integer(value.get("changed"), 0, len(rows))
            and sha(value.get("buildKey")), "Invalid scene preparation receipt")
    seen = set()
    for row in rows:
        require(isinstance(row, dict) and uuid(row.get("cityId")) and row["cityId"] not in seen
                and sha(row.get("sceneRevision")) and integer(row.get("observedWorldVersion"))
                and integer(row.get("chunks"), 1, 4096) and integer(row.get("constructed"), 0, 1)
                and type(row.get("ready")) is bool and type(row.get("changed")) is bool,
                "Invalid or duplicate prepared scene")
        seen.add(row["cityId"])
        if row["ready"]:
            require(integer(row.get("rawBytes"), 1, 128 * 1024 ** 2)
                    and integer(row.get("compressedBytes"), 1, 64 * 1024 ** 2), "Invalid prepared scene byte limit")
    require(value["ready"] == sum(row["ready"] for row in rows)
            and value["changed"] == sum(row["changed"] for row in rows), "Scene readiness counts differ")
    if write:
        require(value["ready"] == len(rows), "Prepared scenes are not ready")
    else:
        require(value["changed"] == 0, "Scene preview claimed writes")
    return {"buildKey": value["buildKey"], "rows": rows, "ready": value["ready"], "changed": value["changed"]}


def prepare_living_city(database, invoke, assert_frozen, now=time.monotonic):
    deadline, reports = now() + DEADLINE_SECONDS, []
    scopes = database.json("SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'cityIds',"
                           "(SELECT COALESCE(jsonb_agg(c.id ORDER BY c.id),'[]') FROM cities_v3 c WHERE c.country_id=p.id),"
                           "'layouts',(SELECT count(*) FROM city_layouts_v1 l WHERE l.country_id=p.id AND l.status='ACTIVE'))"
                           " ORDER BY id),'[]') FROM (SELECT id FROM countries ORDER BY id LIMIT 10001) p")
    require(isinstance(scopes, list) and len(scopes) <= 10000, "Living-city scope exceeds budget")
    country_ids = set()
    for scope in scopes:
        require(isinstance(scope, dict) and uuid(scope.get("id")) and scope["id"] not in country_ids
                and isinstance(scope.get("cityIds"), list) and len(scope["cityIds"]) <= 10000
                and all(uuid(city) for city in scope["cityIds"])
                and len(set(scope["cityIds"])) == len(scope["cityIds"])
                and integer(scope.get("layouts")), "Invalid authoritative living-city scope")
        country_ids.add(scope["id"])
    assert_frozen()
    before, roads = capture_sources(database), road_routes(database)
    for scope in scopes:
        entries = {}
        for entry in ENTRIES:
            receipts = []
            previous_state = None
            for write in (False, True, True):
                assert_frozen()
                remaining = deadline - now()
                require(remaining > 0, "Living-city preparation deadline exceeded")
                before_state = state_digest(database, scope["id"])
                remaining = deadline - now()
                require(remaining > 0, "Living-city preparation deadline exceeded")
                receipts.append(invoke(entry, scope["id"], write, remaining))
                after_state = state_digest(database, scope["id"])
                if not write:
                    require(before_state == after_state, "Living-city preview wrote data")
                if len(receipts) == 3:
                    require(before_state == previous_state == after_state, "Living-city repeat wrote data")
                previous_state = after_state
            preview, first, repeat = receipts
            if entry == "synchronize-transport":
                require(all(receipt["stops"]["cities"] == receipt["stops"]["previewPlans"] == scope["layouts"] for receipt in receipts)
                        and repeat["stops"]["readyBefore"] == scope["layouts"]
                        and repeat["stops"]["changedPlans"] == 0
                        and first["stops"]["checksum"] == repeat["stops"]["checksum"], "Transit repeat changed or omitted plans")
            elif entry == "synchronize-roads":
                require(not repeat["changed"] and preview["checksum"] == first["checksum"] == repeat["checksum"]
                        and preview["after"] == first["after"] == repeat["after"], "Road repeat changed")
            else:
                for receipt in receipts:
                    require(set(row["cityId"] for row in receipt["rows"]) == set(scope["cityIds"]), "Scene CLI omitted a city")
                stable = lambda receipt: {"buildKey": receipt["buildKey"], "ready": receipt["ready"], "rows": [
                    {key: row[key] for key in ("cityId", "sceneRevision", "observedWorldVersion", "chunks", "ready", "rawBytes", "compressedBytes")}
                    for row in receipt["rows"]]}
                require(repeat["changed"] == 0 and all(row["constructed"] == 0 for row in repeat["rows"])
                        and stable(first) == stable(repeat), "Scene repeat changed")
            entries[entry] = {"preview": preview, "first": first, "repeat": repeat}
        reports.append({"countryId": scope["id"], "entries": entries})
    assert_frozen()
    conservation = verify_sources(before, capture_sources(database))
    after_roads = road_routes(database)
    require(all(after_roads.get(key) == value for key, value in roads.items()), "Accepted road route changed")
    require(now() <= deadline, "Living-city preparation deadline exceeded")
    return {"countries": len(scopes), "ready": True, "conservation": conservation,
            "retainedRoads": len(roads), "reports": reports}
