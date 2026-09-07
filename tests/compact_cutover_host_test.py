"""Границы host freeze; production endpoints здесь не используются."""
from pathlib import Path
import sys
import subprocess
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "deploy"))
from compact_cutover_host import DeploymentLock, maintenance_config
from compact_cutover_state import CutoverError


class HostBoundaryTests(unittest.TestCase):
    def test_uses_same_exclusive_lock_as_updater(self):
        with tempfile.TemporaryDirectory() as temporary:
            app = Path(temporary) / "app"
            (app / ".git").mkdir(parents=True)
            with DeploymentLock(app):
                with self.assertRaises(CutoverError):
                    with DeploymentLock(app):
                        self.fail("Concurrent updater was admitted")
                code = ("import fcntl,sys; f=open(sys.argv[1],'a');\n"
                        "try: fcntl.flock(f.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)\n"
                        "except BlockingIOError: sys.exit(17)\n")
                other = subprocess.run([sys.executable, "-c", code, str(app / ".git" / "tasktopia-update.lock")],
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
                self.assertEqual(other.returncode, 17)
            with DeploymentLock(app):
                self.assertTrue((app / ".git" / "tasktopia-update.lock").exists())

    def test_rejects_symlink_lock(self):
        with tempfile.TemporaryDirectory() as temporary:
            app = Path(temporary) / "app"
            (app / ".git").mkdir(parents=True)
            outside = Path(temporary) / "preserve"
            outside.write_text("keep")
            (app / ".git" / "tasktopia-update.lock").symlink_to(outside)
            with self.assertRaises((CutoverError, OSError)):
                with DeploymentLock(app):
                    self.fail("Symlink lock was accepted")
            self.assertEqual(outside.read_text(), "keep")

    def test_maintenance_precedes_redirect_and_covers_both_servers(self):
        original = "server {\n    server_name tasktopia.test;\n    return 301 https://$host$request_uri;\n}\nserver {\n    server_name tasktopia.test;\n}\n"
        rendered = maintenance_config(original, "tasktopia.test", "a" * 64)
        self.assertEqual(rendered.count("return 503;"), 2)
        self.assertLess(rendered.index("return 503;"), rendered.index("return 301"))
        self.assertEqual(rendered.count('add_header X-Tasktopia-Maintenance "' + "a" * 64 + '" always;'), 2)
        for bad in [original.replace("tasktopia.test", "other.test"), original + "server_name tasktopia.test;\n"]:
            with self.assertRaises(CutoverError):
                maintenance_config(bad, "tasktopia.test", "a" * 64)
        with self.assertRaises(CutoverError):
            maintenance_config(original, "tasktopia.test; include /tmp/evil", "a" * 64)

    def test_official_site_keeps_cdn_asset_only(self):
        original = (Path(__file__).resolve().parents[1] / "deploy/nginx-tasktopia.conf").read_text()
        rendered = maintenance_config(original, "tasktopia.online", "a" * 64)
        self.assertEqual(rendered.count("return 503;"), 2)
        self.assertEqual(rendered.split("    server_name tasktopia.online;", 1)[0],
                         original.split("    server_name tasktopia.online;", 1)[0])


if __name__ == "__main__":
    unittest.main()
