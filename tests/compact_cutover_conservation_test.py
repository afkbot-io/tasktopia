from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "deploy"))
from compact_cutover_conservation import project_row, verify_business
from compact_cutover_state import CutoverError


class ConservationTests(unittest.TestCase):
    def test_preserves_task_identity_and_content_but_allows_geometry(self):
        row = {"id": "1", "task_number": 23, "title": "keep", "origin_x": 1}
        self.assertEqual(project_row("tasks_v3", row), project_row("tasks_v3", dict(row, origin_x=100)))
        for field in ("id", "task_number", "title"):
            self.assertNotEqual(project_row("tasks_v3", row), project_row("tasks_v3", dict(row, **{field: "changed"})))

    def test_old_events_and_business_rows_must_remain(self):
        before = {"tasks_v3": ["a"], "events": ["b", "b"]}
        self.assertEqual(verify_business(before, dict(before, events=["b", "b", "c"]))["rowsPreserved"], 3)
        for after in ({"tasks_v3": ["z"], "events": ["b", "b"]},
                      {"tasks_v3": ["a"], "events": ["b", "c"]}):
            with self.assertRaises(CutoverError):
                verify_business(before, after)


if __name__ == "__main__":
    unittest.main()
