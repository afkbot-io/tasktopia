from pathlib import Path
import sys
import json
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "deploy"))
from compact_cutover_driver import HostDriver, validate_cli_log, external_compose, completed_export, validate_controller, retain_image, recovery_image, restore_private_run_mode, prepare_binding
from compact_cutover_database import CommandRunner
from compact_cutover_state import CutoverError


class DriverTests(unittest.TestCase):
    def test_living_cli_keeps_image_argv_limits_and_private_environment(self):
        with tempfile.TemporaryDirectory() as tmp:
            runner = CommandRunner(Path(tmp))
            image = "sha256:" + "a" * 64
            compose = runner.publish_json("compose.json", {"services": {"world": {"environment": {"DATABASE_URL": "private-test-uri"}}}})
            driver = object.__new__(HostDriver)
            driver.r = runner
            driver.b = {"candidateCompose": compose, "network": "fixed-network"}
            driver.j = SimpleNamespace(plan={"candidateImage": image, "runId": "compact-fixture-1234"})
            country = "00000000-0000-4000-8000-000000000001"
            receipt = {"event": "roads.synchronization", "countryId": country, "mode": "write", "changed": False,
                       "after": {"plannerVersion": 4, "revision": 1, "routes": 0}, "checksum": "b" * 64}
            calls, stopped = [], []
            def command(args, **options):
                calls.append((args, options))
                if args[0] == "create": return b"container-id"
                if args[0] == "start": return json.dumps(receipt).encode()
                if args[0] == "inspect":
                    return json.dumps([{"Image": image, "State": {"Running": False, "ExitCode": 0}}]).encode()
                raise AssertionError("Unplanned test command")
            driver.command = command
            driver.stop_run_commands = lambda: stopped.append(True)
            self.assertFalse(driver.run_living_cli("synchronize-roads", country, True, 123.5)["changed"])
            argv = calls[0][0]
            self.assertEqual(argv[-5:], [image, "dist/synchronize-roads.mjs", "--country", country, "--write"])
            for flag in ("--read-only", "--cap-drop", "--security-opt", "--memory", "--cpus", "--pids-limit"):
                self.assertIn(flag, argv)
            self.assertEqual(calls[1][1], {"timeout": 123.5, "max_bytes": 32 * 1024 ** 2})
            env = Path(argv[argv.index("--env-file") + 1])
            self.assertEqual(env.stat().st_mode & 0o777, 0o600)
            self.assertNotIn("REGENERATION_", env.read_text())
            self.assertEqual(stopped, [True])
            receipt["countryId"] = "00000000-0000-4000-8000-000000000002"
            with self.assertRaises(CutoverError):
                driver.run_living_cli("synchronize-roads", country, True, 123.5)
            self.assertEqual(stopped, [True, True])

    def test_living_flag_requires_preservation_and_cannot_launch_an_unplanned_command(self):
        with self.assertRaises(CutoverError):
            prepare_binding(None, None, "old", "new", "run", prepare_living_city=True)
        driver = object.__new__(HostDriver)
        for binding in ({}, {"preserveWorld": True}, {"prepareLivingCity": True}):
            driver.b = binding
            with self.assertRaises(CutoverError):
                driver.prepare_living_city("closed")
        for entry, country, write, timeout in (("bash", "x", True, 1),
                ("synchronize-roads", "x; injected", True, 1),
                ("synchronize-roads", "00000000-0000-4000-8000-000000000001", True, True)):
            with self.assertRaises(CutoverError):
                driver.run_living_cli(entry, country, write, timeout)
        for entry, args, regeneration in (("bash", [], False), ("migrate-worlds", ["--write"], True),
                ("synchronize-roads", ["--country", "x"], False)):
            with self.assertRaises(CutoverError):
                driver.execute_cli(entry, args, 1, regeneration)

    def test_preparation_failure_or_changed_migration_never_reaches_audit(self):
        for opt_in in (False, True):
            for failure in ("migration", "living", None):
                driver = object.__new__(HostDriver)
                plan = {"revision": "fixed"}
                driver.j = SimpleNamespace(plan=plan)
                driver.lock = SimpleNamespace(fd=9)
                driver.b = {"preserveWorld": True, "prepareLivingCity": opt_in}
                driver.db, driver.r = SimpleNamespace(), SimpleNamespace()
                driver.fixed_binding = lambda: None
                driver.evidence = lambda evidence, name: {"nginx": "closed"} if name == "inspect" else {"countries": 1, "business": "before"}
                calls = []
                driver.assert_frozen = lambda nginx: calls.append("freeze")
                def living(nginx):
                    calls.append("living")
                    if failure == "living":
                        raise CutoverError("failed preparation")
                    return {"ready": True}
                driver.prepare_living_city = living
                driver.run_cli = lambda *a: calls.append("audit") or {}
                driver.publish = lambda value: value
                before = {"tasks_v3": ["fixed"]}
                after = {"tasks_v3": ["moved"]} if failure == "migration" else before
                with patch("compact_cutover_driver.read_json", return_value=before), \
                        patch("compact_cutover_driver.capture_business", return_value=after):
                    if failure == "migration" or opt_in and failure == "living":
                        with self.assertRaises(CutoverError):
                            driver._run("verify_conservation_and_audit", plan, {})
                        self.assertNotIn("audit", calls)
                    else:
                        driver._run("verify_conservation_and_audit", plan, {})
                        self.assertEqual(calls[-1], "audit")
                self.assertEqual("living" in calls, opt_in and failure != "migration")

    def test_explicit_living_preparation_runs_after_migration_conservation_before_audit(self):
        driver = object.__new__(HostDriver)
        plan = {"revision": "fixed"}
        driver.j = SimpleNamespace(plan=plan)
        driver.lock = SimpleNamespace(fd=9)
        driver.b = {"preserveWorld": True, "prepareLivingCity": True}
        driver.db = SimpleNamespace()
        driver.r = SimpleNamespace()
        driver.fixed_binding = lambda: None
        driver.evidence = lambda evidence, name: {"nginx": "closed"} if name == "inspect" else {"countries": 1, "business": "before"}
        calls = []
        driver.assert_frozen = lambda nginx: calls.append("freeze")
        driver.prepare_living_city = lambda nginx: calls.append("living") or {"ready": True}
        driver.run_cli = lambda entry, countries: calls.append(entry) or {"ok": True}
        driver.publish = lambda value: value
        before = {"tasks_v3": ["unchanged"]}
        with patch("compact_cutover_driver.read_json", return_value=before), \
                patch("compact_cutover_driver.capture_business", side_effect=lambda *a, **kw: calls.append("conservation") or before):
            result = driver._run("verify_conservation_and_audit", plan, {})
        self.assertEqual(calls, ["freeze", "conservation", "living", "audit-worlds"])
        self.assertEqual(result["livingCity"], {"ready": True})

    def test_migration_only_requires_completion_and_does_not_accept_regeneration(self):
        self.assertEqual(validate_cli_log(b'{"event":"world-migration.finished"}\n', "migrate-worlds", 3)["countries"], 3)
        for output in (b'', b'{"event":"world-regeneration.finished"}\n'):
            with self.assertRaises(CutoverError):
                validate_cli_log(output, "migrate-worlds", 3)

    def test_preserve_mode_dispatches_migration_under_same_freeze(self):
        for preserve, expected in ((False, "regenerate-worlds"), (True, "migrate-worlds")):
            driver = object.__new__(HostDriver)
            plan = {"revision": "fixed"}
            driver.j = SimpleNamespace(plan=plan)
            driver.lock = SimpleNamespace(fd=9)
            driver.b = {"preserveWorld": preserve}
            driver.fixed_binding = lambda: None
            driver.evidence = lambda evidence, name: {"nginx": "closed"} if name == "inspect" else {"countries": 2}
            calls = []
            driver.assert_frozen = lambda nginx: calls.append(("freeze", nginx))
            driver.run_cli = lambda entry, countries: calls.append((entry, countries)) or {"ok": True}
            driver.publish = lambda value: value
            driver._run("migrate_and_regenerate", plan, {})
            self.assertEqual(calls, [("freeze", "closed"), (expected, 2)])

    def test_recovery_repairs_only_owned_readable_run_under_private_parent(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run = root / "compact-fixture-1234"
            run.mkdir(mode=0o755)
            for action in ("prepare", "accept"):
                with self.assertRaises(CutoverError):
                    restore_private_run_mode(run, action)
            self.assertTrue(restore_private_run_mode(run, "recover"))
            self.assertEqual(run.stat().st_mode & 0o777, 0o700)
            self.assertFalse(restore_private_run_mode(run, "recover"))
            run.chmod(0o777)
            with self.assertRaises(CutoverError):
                restore_private_run_mode(run, "recover")
            run.chmod(0o755)
            root.chmod(0o755)
            with self.assertRaises(CutoverError):
                restore_private_run_mode(run, "recover")
            root.chmod(0o700)
            link = root / "compact-link-1234"
            link.symlink_to(run)
            with self.assertRaises(CutoverError):
                restore_private_run_mode(link, "recover")

    def test_retained_image_requires_archive_restore_identity(self):
        image = "sha256:" + "a" * 64
        commands = []
        def command(args, **kw):
            commands.append(args)
            if args[:2] == ["image", "inspect"]:
                return json.dumps([{"Id": image if len(commands) < 5 else "sha256:" + "b" * 64}]).encode()
            if args[:2] == ["image", "save"]:
                return {"artifact": "previous-image.tar", "sha256": "c" * 64, "bytes": 123}
            return b""
        runner = SimpleNamespace(directory=Path("/private/audit"), verify=lambda record: None)
        with self.assertRaises(CutoverError):
            retain_image(command, runner, image, "compact-fixture-1234", "previous")
        self.assertEqual(commands[0], ["tag", image, "tasktopia-cutover:compact-fixture-1234-previous"])
        self.assertIn(["image", "load", "--input", "/private/audit/previous-image.tar"], commands)
        self.assertEqual(recovery_image({"previousImage": image}, {}), image)
        self.assertEqual(recovery_image({"previousImage": image}, {"previousRecoveryImage": "rebuilt"}), "rebuilt")

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
