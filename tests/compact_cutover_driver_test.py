from pathlib import Path
import sys
import json
import tempfile
from types import SimpleNamespace
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "deploy"))
from compact_cutover_driver import HostDriver, validate_cli_log, external_compose, completed_export, validate_controller
from compact_cutover_database import CommandRunner
from compact_cutover_state import CutoverError


class DriverTests(unittest.TestCase):
    def test_start_uses_only_saved_local_image_without_pull_or_build(self):
        driver = object.__new__(HostDriver)
        driver.r = SimpleNamespace(verify=lambda record: None, directory=Path("/private/audit"))
        driver.b = {"appDir": "/srv/tasktopia/app", "previousCompose": {"artifact": "previous.json"}}
        driver.j = SimpleNamespace(plan={"project": "app"})
        commands = []
        driver.command = lambda args, **kw: commands.append(args)
        driver.roles = lambda: {}
        driver.start_roles(previous=True)
        self.assertIn("--no-build", commands[0])
        index = commands[0].index("--pull")
        self.assertEqual(commands[0][index + 1], "never")

    def test_recovery_restarts_exact_existing_old_roles_without_recreation(self):
        driver = object.__new__(HostDriver)
        driver.j = SimpleNamespace(plan={"previousImage": "old"})
        driver.roles = lambda: {role: {"Id": role + "-id", "Image": "old"} for role in ("app", "mcp", "world")}
        commands = []
        driver.command = lambda args, **kw: commands.append(args)
        driver.start_roles(previous=True)
        self.assertEqual(commands, [["start", "app-id", "mcp-id", "world-id"]])

    def test_recovery_only_retires_exact_completed_export_not_runtime(self):
        image = "sha256:" + "b" * 64
        info = {"Name": "/tasktopia-compact-export-" + "a" * 32, "Image": image, "Mounts": [],
                "Config": {"Entrypoint": ["node"], "Cmd": ["dist/synchronize-assets.mjs"]},
                "State": {"Running": False, "ExitCode": 0},
                "HostConfig": {"NetworkMode": "none", "RestartPolicy": {"Name": "no"}}}
        self.assertTrue(completed_export(info, image))
        for key, value in [("Name", "/app-app-1"), ("Image", "sha256:" + "c" * 64),
                           ("State", {"Running": True, "ExitCode": 0}), ("Mounts", [{"Type": "volume"}]),
                           ("Config", {"Entrypoint": ["node"], "Cmd": ["dist/index.mjs"]})]:
            changed = dict(info)
            changed[key] = value
            self.assertFalse(completed_export(changed, image))

    def test_new_controller_can_only_recover_explicit_old_plan(self):
        old, new = "a" * 40, "b" * 40
        validate_controller("recover", new, old, old, "RECOVERY_REQUIRED")
        validate_controller("accept", new, old, old, "ROLLED_BACK_CLOSED")
        for action, declared, status in [("prepare", old, "NEW"), ("recover", None, "RECOVERY_REQUIRED"),
                                          ("accept", old, "READY"), ("accept", old, "OPENING")]:
            with self.assertRaises(CutoverError):
                validate_controller(action, new, old, declared, status)

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
