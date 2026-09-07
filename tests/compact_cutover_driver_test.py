from pathlib import Path
import sys
import json
import tempfile
from types import SimpleNamespace
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "deploy"))
from compact_cutover_driver import HostDriver, validate_cli_log, external_compose
from compact_cutover_database import CommandRunner
from compact_cutover_state import CutoverError


class DriverTests(unittest.TestCase):
    def test_changed_environment_mount_or_network_is_rejected_before_stop(self):
        with tempfile.TemporaryDirectory() as tmp:
            runner = CommandRunner(Path(tmp))
            image = "sha256:" + "a" * 64
            record = runner.publish_json("compose.json", {"services": {"app": {"environment": {"RUNTIME_ROLE": "web"}}}})
            info = {"Image": image, "Config": {"Labels": {"com.docker.compose.service": "app",
                    "com.docker.compose.project.working_dir": "/srv/tasktopia/app"}, "Env": ["RUNTIME_ROLE=web"]},
                    "HostConfig": {"RestartPolicy": {"Name": "unless-stopped"}}, "Mounts": [],
                    "NetworkSettings": {"Networks": {"fixture-net": {}}}}
            driver = object.__new__(HostDriver)
            driver.r = runner
            driver.j = SimpleNamespace(plan={"project": "fixture", "previousImage": image,
                                             "candidateImage": "sha256:" + "b" * 64})
            driver.b = {"appDir": "/srv/tasktopia/app", "previousCompose": record, "network": "fixture-net"}
            driver.command = lambda args: b"container" if args[0] == "ps" else json.dumps([info]).encode()
            self.assertIn("app", driver.roles())
            info["Config"]["Env"] = ["RUNTIME_ROLE=world"]
            with self.assertRaises(CutoverError):
                driver.roles()
            info["Config"]["Env"] = ["RUNTIME_ROLE=web"]
            info["NetworkSettings"]["Networks"] = {"another-net": {}}
            with self.assertRaises(CutoverError):
                driver.roles()
            info["NetworkSettings"]["Networks"] = {"fixture-net": {}}
            info["Mounts"] = [{"Type": "volume", "Name": "unexpected", "Destination": "/data/uploads"}]
            with self.assertRaises(CutoverError):
                driver.roles()

    def test_requires_every_country_and_zero_violations(self):
        good = b'{"event":"world-regeneration.completed","violationsAfter":0}\n{"event":"world-regeneration.finished","countries":1}\n'
        self.assertEqual(validate_cli_log(good, "regenerate-worlds", 1)["countries"], 1)
        for log, count in [(good, 2), (good.replace(b'":0', b'":1'), 1),
                           (b'{"event":"world-regeneration.finished","countries":1}\n', 1)]:
            with self.assertRaises(CutoverError):
                validate_cli_log(log, "regenerate-worlds", count)
        with self.assertRaises(CutoverError):
            validate_cli_log(b'{"violations":["bad"]}\n', "audit-worlds", 1)

    def test_compose_reuses_existing_volumes_and_pins_all_roles(self):
        source = {"services": {r: {"image": "latest", "build": {"context": "."}}
                               for r in ("app", "mcp", "world", "postgres")},
                  "volumes": {"uploads": {"name": "app_uploads"}},
                  "networks": {"default": {"name": "app_default"}}}
        result = external_compose(source, "sha256:" + "a" * 64)
        self.assertEqual(result["volumes"]["uploads"], {"name": "app_uploads", "external": True})
        self.assertEqual(result["services"]["app"]["image"], "sha256:" + "a" * 64)
        self.assertNotIn("build", result["services"]["app"])
        self.assertEqual(source["services"]["app"]["image"], "latest")


if __name__ == "__main__":
    unittest.main()
