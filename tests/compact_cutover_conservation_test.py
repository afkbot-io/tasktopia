from pathlib import Path
import sys
import unittest
import tempfile
import json
from types import SimpleNamespace
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "deploy"))
from compact_cutover_conservation import project_row, verify_business, capture_business
from compact_cutover_state import CutoverError


class ConservationTests(unittest.TestCase):
    def test_preserves_task_identity_and_content_but_allows_geometry(self):
        row = {"id": "1", "task_number": 23, "title": "keep", "origin_x": 1}
        self.assertEqual(project_row("tasks_v3", row), project_row("tasks_v3", dict(row, origin_x=100)))
        for field in ("id", "task_number", "title"):
            self.assertNotEqual(project_row("tasks_v3", row), project_row("tasks_v3", dict(row, **{field: "changed"})))

    def test_preserve_mode_rejects_geometry_and_nonnull_terrain_changes(self):
        row = {"id": "1", "origin_x": 5, "service_role": "SHOP"}
        self.assertNotEqual(project_row("tasks_v3", row, True),
                            project_row("tasks_v3", dict(row, origin_x=6), True))
        country = {"id": "country", "world_version": 4}
        self.assertEqual(project_row("countries", country, True),
                         project_row("countries", dict(country, terrain_profile_json=None), True))
        self.assertNotEqual(project_row("countries", country, True),
                            project_row("countries", dict(country, terrain_profile_json={"kind": "EAST_COAST"}), True))

    def test_preserve_snapshot_includes_spatial_tables(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            runner = SimpleNamespace(directory=root, open_private=lambda name: (root / name).open("rb"))
            seen = []
            def sql(query, output_name, max_bytes):
                seen.append(query)
                (root / output_name).write_text(json.dumps({"id": "existing", "origin_x": 12}) + "\n")
            db = SimpleNamespace(runner=runner, json=lambda query: ["tasks_v3", "city_layouts_v1"], sql=sql)
            result = capture_business(db, preserve_world=True)
            self.assertEqual(set(result), {"tasks_v3", "city_layouts_v1"})
            self.assertEqual(len(seen), 2)
            self.assertEqual(set(capture_business(db)), {"tasks_v3"})

    def test_old_events_and_business_rows_must_remain(self):
        before = {"tasks_v3": ["a"], "events": ["b", "b"]}
        self.assertEqual(verify_business(before, dict(before, events=["b", "b", "c"]))["rowsPreserved"], 3)
        for after in ({"tasks_v3": ["z"], "events": ["b", "b"]},
                      {"tasks_v3": ["a"], "events": ["b", "c"]}):
            with self.assertRaises(CutoverError):
                verify_business(before, after)


if __name__ == "__main__":
    unittest.main()
