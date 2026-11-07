import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "deploy"))
import living_city_preparation as living
from compact_cutover_state import CutoverError

COUNTRY = "00000000-0000-4000-8000-000000000001"
CITY = "00000000-0000-4000-8000-000000000002"
HASH = "a" * 64


def receipt(entry, write):
    common = {"countryId": COUNTRY, "mode": "write" if write else "dry-run"}
    if entry == "synchronize-transport":
        return dict(common, event="transport.synchronization", transitStops={
            "cities": 1, "readyBefore": 1, "readyAfter": 1, "previewPlans": 1,
            "stops": 2, "changedPlans": 0, "checksum": HASH})
    if entry == "synchronize-roads":
        return dict(common, event="roads.synchronization", changed=False, checksum=HASH,
                    after={"plannerVersion": 4, "revision": 1, "routes": 1})
    return dict(common, event="city-scenes.synchronization", cities=1, ready=1, changed=0, buildKey=HASH,
                rows=[{"cityId": CITY, "sceneRevision": HASH, "observedWorldVersion": 1,
                       "chunks": 576, "constructed": 0, "ready": True, "changed": False,
                       "rawBytes": 37_000_000, "compressedBytes": 3_000_000}])


class PreparationTests(unittest.TestCase):
    def test_validates_real_contract_shapes_and_rejects_scope_mode_and_extra_output(self):
        for entry in living.ENTRIES:
            for write in (False, True):
                good = receipt(entry, write)
                self.assertTrue(living.validate_receipt(json.dumps(good), entry, COUNTRY, write))
                for bad in (dict(good, countryId=CITY), dict(good, mode="other"),
                            dict(good, event="other")):
                    with self.subTest(entry=entry, bad=bad), self.assertRaises(CutoverError):
                        living.validate_receipt(json.dumps(bad), entry, COUNTRY, write)
                with self.assertRaises(CutoverError):
                    living.validate_receipt(json.dumps(good) + "\n{}", entry, COUNTRY, write)
        with self.assertRaises(CutoverError):
            living.validate_receipt("{}", "other", COUNTRY, True)

    def test_rejects_unready_duplicate_oversized_and_noninteger_receipts(self):
        cases = []
        for field, value in (("readyAfter", 0), ("cities", True), ("stops", -1), ("checksum", "wrong")):
            bad = receipt("synchronize-transport", True)
            bad["transitStops"][field] = value
            cases.append(("synchronize-transport", True, bad))
        for field, value in (("plannerVersion", True), ("revision", 0), ("routes", 101)):
            bad = receipt("synchronize-roads", True)
            bad["after"][field] = value
            cases.append(("synchronize-roads", True, bad))
        for field, value in (("chunks", 4097), ("constructed", 2), ("ready", 1),
                             ("rawBytes", 128 * 1024 ** 2 + 1), ("compressedBytes", 64 * 1024 ** 2 + 1),
                             ("observedWorldVersion", -1), ("sceneRevision", "wrong")):
            bad = receipt("synchronize-city-scenes", True)
            bad["rows"][0][field] = value
            cases.append(("synchronize-city-scenes", True, bad))
        duplicate = receipt("synchronize-city-scenes", True)
        duplicate.update(cities=2, ready=2, rows=duplicate["rows"] * 2)
        cases.append(("synchronize-city-scenes", True, duplicate))
        preview = receipt("synchronize-city-scenes", False)
        preview.update(changed=1)
        preview["rows"][0]["changed"] = True
        cases.append(("synchronize-city-scenes", False, preview))
        preview = receipt("synchronize-transport", False)
        preview["transitStops"]["changedPlans"] = 1
        cases.append(("synchronize-transport", False, preview))
        for entry, write, bad in cases:
            with self.subTest(entry=entry, bad=bad), self.assertRaises(CutoverError):
                living.validate_receipt(json.dumps(bad), entry, COUNTRY, write)

    def test_sources_are_exact_and_only_new_frozen_plan_rows_may_be_added(self):
        before = {"tasks_v3": ["task"], "events": ["event"], "road_networks_v1": ["geometry"],
                  "city_transit_stop_plans_v1": ["old", "old"]}
        after = dict(before, city_transit_stop_plans_v1=["old", "old", "new"])
        self.assertEqual(living.verify_sources(before, after)["rowsPreserved"], 5)
        for bad in (dict(after, tasks_v3=["moved"]), dict(after, events=["event", "new"]),
                    dict(after, road_networks_v1=[]), dict(after, city_transit_stop_plans_v1=["old", "new"]),
                    dict(after, unknown=[])):
            with self.assertRaises(CutoverError):
                living.verify_sources(before, bad)

    def test_capture_excludes_only_named_caches_and_only_country_publication_version(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = {"countries": {"id": COUNTRY, "world_version": 1, "name": "keep"},
                      "tasks_v3": {"id": "task", "origin_x": 1},
                      "future_source": {"id": "future", "value": 1}}
            runner = SimpleNamespace(directory=root, open_private=lambda name: (root / name).open("rb"))
            def sql(query, output_name, max_bytes):
                table = query.split('public."')[1].split('"')[0]
                (root / output_name).write_text(json.dumps(source[table]) + "\n")
            db = SimpleNamespace(runner=runner, sql=sql, json=lambda query: sorted(set(source) | living.DERIVED_TABLES))
            before = living.capture_sources(db)
            self.assertEqual(set(before), set(source))
            source["countries"]["world_version"] = 2
            self.assertEqual(living.capture_sources(db), before)
            for table, field in (("countries", "name"), ("tasks_v3", "origin_x"), ("future_source", "value")):
                old = source[table][field]
                source[table][field] = "changed"
                with self.assertRaises(CutoverError):
                    living.verify_sources(before, living.capture_sources(db))
                source[table][field] = old

    def run_preparation(self, mutate=None, states=None, clock=lambda: 0):
        class Authority:
            def json(self, query):
                return [{"id": COUNTRY, "cityIds": [CITY], "layouts": 1}]
        calls, freeze = [], []
        counts = {entry: 0 for entry in living.ENTRIES}
        def invoke(entry, country_id, write, remaining):
            self.assertEqual(country_id, COUNTRY)
            self.assertTrue(0 < remaining <= 1800)
            calls.append((entry, write))
            value = living.validate_receipt(json.dumps(receipt(entry, write)), entry, country_id, write)
            index = counts[entry]
            counts[entry] += 1
            if mutate:
                mutate(entry, index, value)
            return value
        with patch.object(living, "capture_sources", return_value={"tasks_v3": ["fixed"]}), \
                patch.object(living, "road_routes", return_value={(COUNTRY, "road"): b"fixed"}), \
                patch.object(living, "state_digest", side_effect=states or (lambda *a: {"same": HASH})):
            result = living.prepare_living_city(Authority(), invoke, lambda: freeze.append(True), now=clock)
        self.assertEqual(calls, [(entry, write) for entry in living.ENTRIES for write in (False, True, True)])
        self.assertEqual(len(freeze), 11)
        return result

    def test_orders_all_three_phases_and_requires_physical_noop_repeat(self):
        self.assertTrue(self.run_preparation()["ready"])
        for entry in living.ENTRIES:
            def change(name, index, value):
                if name == entry and index == 2:
                    if entry == "synchronize-transport":
                        value["stops"]["changedPlans"] = 1
                    elif entry == "synchronize-roads":
                        value["checksum"] = "b" * 64
                    else:
                        value["rows"][0]["constructed"] = 1
            with self.subTest(entry=entry), self.assertRaises(CutoverError):
                self.run_preparation(change)
        for bad_states in ([0, 1], [0, 0, 0, 1, 1, 2]):
            with self.assertRaises(CutoverError):
                self.run_preparation(states=lambda *a, it=iter(bad_states): next(it))

    def test_rejects_omitted_city_or_layout_even_with_valid_receipt(self):
        def omit_city(entry, index, value):
            if entry == "synchronize-city-scenes":
                value["rows"][0]["cityId"] = COUNTRY
        def omit_layout(entry, index, value):
            if entry == "synchronize-transport":
                value["stops"]["cities"] = 0
        for mutate in (omit_city, omit_layout):
            with self.assertRaises(CutoverError):
                self.run_preparation(mutate)

    def test_deadline_stops_preparation(self):
        ticks = iter([0, 1801])
        with self.assertRaises(CutoverError):
            self.run_preparation(clock=lambda: next(ticks))

    def test_retained_road_identity_is_scoped_and_duplicates_rejected(self):
        class Roads:
            def json(self, query):
                return [{"countryId": COUNTRY, "routes": [{"id": "r", "path": [1, 2]}]}]
        self.assertIn((COUNTRY, "r"), living.road_routes(Roads()))
        with patch.object(Roads, "json", return_value=[{"countryId": COUNTRY, "routes": [{"id": "r"}] * 2}]):
            with self.assertRaises(CutoverError):
                living.road_routes(Roads())


if __name__ == "__main__":
    unittest.main()
