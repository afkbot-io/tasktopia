import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import unittest

source = Path(__file__).resolve().parents[1] / "deploy" / "compact_cutover_state.py"
spec = importlib.util.spec_from_file_location("compact_cutover_state", source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def plan():
    return {"version": 1, "runId": "compact-20260907-a", "project": "app",
            "appDir": "/srv/tasktopia/app", "revision": "a" * 40,
            "previousImage": "sha256:" + "b" * 64,
            "candidateImage": "sha256:" + "c" * 64,
            "previousStatic": "/srv/tasktopia/static/releases/previous",
            "database": "tasktopia", "targetId": "f" * 64}


class Crash(BaseException):
    pass


class Driver:
    def __init__(self, fail=None, crash=None):
        self.calls = []
        self.fail = fail
        self.crash = crash

    def run(self, operation, bound_plan, evidence):
        self.calls.append(operation)
        if operation == self.crash:
            raise Crash(operation)
        if operation == self.fail:
            raise RuntimeError("private database connection details must not leak")
        return {"artifact": operation + ".json", "sha256": "d" * 64}


class CutoverTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="task14-cutover-state-")
        self.directory = Path(self.tmp.name) / "journal"

    def tearDown(self):
        self.tmp.cleanup()

    def state(self):
        return json.loads((self.directory / "state.json").read_text())

    def test_success_waits_for_acceptance_and_never_reopens_early(self):
        driver = Driver()
        with module.Journal(self.directory, plan()) as journal:
            module.prepare(journal, driver)
        self.assertEqual(driver.calls, list(module.FORWARD))
        self.assertEqual(self.state()["status"], "READY")
        self.assertNotIn("open_traffic", driver.calls)
        self.assertEqual((self.directory / "state.json").stat().st_mode & 0o777, 0o600)

    def test_failure_at_each_step_does_not_open_traffic(self):
        for operation in module.FORWARD:
            with self.subTest(operation=operation), tempfile.TemporaryDirectory() as tmp:
                driver = Driver(fail=operation)
                with module.Journal(Path(tmp) / "journal", plan()) as journal:
                    with self.assertRaises(module.CutoverError):
                        module.prepare(journal, driver)
                state = json.loads((Path(tmp) / "journal/state.json").read_text())
                self.assertEqual(state["status"], "RECOVERY_REQUIRED")
                self.assertNotIn("open_traffic", driver.calls)
                self.assertNotIn("private database", json.dumps(state))

    def test_crash_before_completion_requires_recovery_not_resume(self):
        driver = Driver(crash="migrate_and_regenerate")
        with self.assertRaises(Crash):
            with module.Journal(self.directory, plan()) as journal:
                module.prepare(journal, driver)
        self.assertEqual(self.state()["pending"], "migrate_and_regenerate")
        with module.Journal(self.directory, plan()) as journal:
            with self.assertRaises(module.CutoverError):
                module.prepare(journal, Driver())
            recovery = Driver()
            module.recover(journal, recovery)
        self.assertEqual(recovery.calls, list(module.RECOVERY))
        self.assertEqual(self.state()["status"], "ROLLED_BACK_CLOSED")
        self.assertNotIn("open_traffic", recovery.calls)

    def test_recovery_failure_never_starts_old_binary_before_verified_restore(self):
        driver = Driver(crash="migrate_and_regenerate")
        with self.assertRaises(Crash):
            with module.Journal(self.directory, plan()) as journal:
                module.prepare(journal, driver)
        with module.Journal(self.directory, plan()) as journal:
            recovery = Driver(fail="verify_restored_baseline")
            with self.assertRaises(module.CutoverError):
                module.recover(journal, recovery)
        self.assertNotIn("start_previous_roles", recovery.calls)
        self.assertNotIn("open_traffic", recovery.calls)
        with module.Journal(self.directory, plan()) as journal:
            retry = Driver()
            module.recover(journal, retry)
        self.assertEqual(retry.calls, list(module.RECOVERY))

    def test_changed_plan_and_second_operator_are_rejected(self):
        with module.Journal(self.directory, plan()):
            with self.assertRaises(module.CutoverError):
                with module.Journal(self.directory, plan()):
                    pass
        changed = plan()
        changed["candidateImage"] = "sha256:" + "e" * 64
        with self.assertRaises(module.CutoverError):
            with module.Journal(self.directory, changed):
                pass

    def test_accept_is_explicit_and_post_open_restore_is_forbidden(self):
        with module.Journal(self.directory, plan()) as journal:
            module.prepare(journal, Driver())
            driver = Driver()
            module.accept(journal, driver, journal.plan_digest)
        self.assertEqual(driver.calls, ["verify_acceptance", "open_traffic"])
        self.assertEqual(self.state()["status"], "ACCEPTED")
        with module.Journal(self.directory, plan()) as journal:
            with self.assertRaises(module.CutoverError):
                module.recover(journal, Driver())

    def test_uncertain_traffic_open_does_not_restore_an_old_backup(self):
        with module.Journal(self.directory, plan()) as journal:
            module.prepare(journal, Driver())
            with self.assertRaises(Crash):
                module.accept(journal, Driver(crash="open_traffic"), journal.plan_digest)
        with module.Journal(self.directory, plan()) as journal:
            with self.assertRaises(module.CutoverError):
                module.recover(journal, Driver())
        self.assertEqual(self.state()["pending"], "open_traffic")

    def test_missing_or_malformed_evidence_cannot_advance(self):
        class EmptyDriver(Driver):
            def run(self, operation, bound_plan, evidence):
                return {"passed": True}
        with module.Journal(self.directory, plan()) as journal:
            with self.assertRaises(module.CutoverError):
                module.prepare(journal, EmptyDriver())
        self.assertEqual(self.state()["status"], "RECOVERY_REQUIRED")

    def test_backup_is_required_before_any_destructive_restore(self):
        with module.Journal(self.directory, plan()) as journal:
            with self.assertRaises(module.CutoverError):
                module.prepare(journal, Driver(fail="backup"))
            recovery = Driver()
            module.recover(journal, recovery)
        self.assertNotIn("restore_database", recovery.calls)
        self.assertIn("verify_original_baseline", recovery.calls)
        self.assertEqual(self.state()["status"], "ROLLED_BACK_CLOSED")

    def test_each_forward_crash_has_a_recoverable_durable_pending_step(self):
        for operation in module.FORWARD:
            with self.subTest(operation=operation), tempfile.TemporaryDirectory() as tmp:
                directory = Path(tmp) / "journal"
                with self.assertRaises(Crash):
                    with module.Journal(directory, plan()) as journal:
                        module.prepare(journal, Driver(crash=operation))
                with module.Journal(directory, plan()) as journal:
                    self.assertEqual(journal.state["pending"], operation)
                    driver = Driver()
                    module.recover(journal, driver)
                self.assertNotIn("open_traffic", driver.calls)
                self.assertEqual(driver.calls[:3], ["enable_maintenance", "stop_writers", "assert_frozen"])

    def test_every_recovery_crash_repeats_the_full_restore_not_only_remaining_steps(self):
        for operation in module.RECOVERY:
            with self.subTest(operation=operation), tempfile.TemporaryDirectory() as tmp:
                directory = Path(tmp) / "journal"
                with self.assertRaises(Crash):
                    with module.Journal(directory, plan()) as journal:
                        module.prepare(journal, Driver(crash="migrate_and_regenerate"))
                with self.assertRaises(Crash):
                    with module.Journal(directory, plan()) as journal:
                        module.recover(journal, Driver(crash=operation))
                with module.Journal(directory, plan()) as journal:
                    driver = Driver()
                    module.recover(journal, driver)
                self.assertEqual(driver.calls, list(module.RECOVERY))

    def test_failed_acceptance_and_uncertain_open_never_trigger_automatic_restore(self):
        for operation in ("verify_acceptance", "open_traffic"):
            with self.subTest(operation=operation), tempfile.TemporaryDirectory() as tmp:
                with module.Journal(Path(tmp) / "journal", plan()) as journal:
                    module.prepare(journal, Driver())
                    driver = Driver(fail=operation)
                    with self.assertRaises(module.CutoverError):
                        module.accept(journal, driver, journal.plan_digest)
                    self.assertNotIn("restore_database", driver.calls)
                    if operation == "open_traffic":
                        with self.assertRaises(module.CutoverError):
                            module.recover(journal, Driver())
                    else:
                        self.assertNotIn("open_traffic", driver.calls)

    def test_invalid_and_unbound_plans_do_not_create_journals(self):
        for field, value in [
            ("revision", "main"), ("revision", "a" * 39),
            ("candidateImage", "tasktopia:latest"), ("candidateImage", "sha256:" + "b" * 64),
            ("database", "postgres"), ("appDir", "/"), ("appDir", "/srv/../etc"),
            ("runId", "x; touch /tmp/escape"), ("targetId", ""), ("version", True),
        ]:
            with self.subTest(field=field, value=value):
                invalid = plan()
                invalid[field] = value
                with self.assertRaises(module.CutoverError):
                    with module.Journal(self.directory, invalid):
                        pass
                self.assertFalse(self.directory.exists())

    def test_another_target_cannot_reuse_the_same_images_and_revision(self):
        with module.Journal(self.directory, plan()):
            pass
        another = plan()
        another["targetId"] = "0" * 64
        with self.assertRaises(module.CutoverError):
            with module.Journal(self.directory, another):
                pass

    def test_symlink_state_cannot_read_or_overwrite_an_unrelated_file(self):
        outside = Path(self.tmp.name) / "keep.json"
        outside.write_text("keep")
        self.directory.mkdir(mode=0o700)
        (self.directory / "state.json").symlink_to(outside)
        with self.assertRaises(OSError):
            with module.Journal(self.directory, plan()):
                pass
        self.assertEqual(outside.read_text(), "keep")

    def test_malformed_state_and_missing_steps_fail_closed(self):
        with module.Journal(self.directory, plan()) as journal:
            journal.state["status"] = "READY"
            journal.save()
        with module.Journal(self.directory, plan()) as journal:
            driver = Driver()
            with self.assertRaises(module.CutoverError):
                module.accept(journal, driver, journal.plan_digest)
            self.assertEqual(driver.calls, [])
        (self.directory / "state.json").write_text("{")
        with self.assertRaises(ValueError):
            with module.Journal(self.directory, plan()):
                pass

    def test_wrong_acceptance_digest_runs_no_adapter_operation(self):
        with module.Journal(self.directory, plan()) as journal:
            module.prepare(journal, Driver())
            driver = Driver()
            with self.assertRaises(module.CutoverError):
                module.accept(journal, driver, "0" * 64)
            self.assertEqual(driver.calls, [])

    def test_confirmed_rollback_reopens_only_after_previous_role_smoke(self):
        with module.Journal(self.directory, plan()) as journal:
            module.prepare(journal, Driver())
            module.recover(journal, Driver())
            driver = Driver()
            module.accept(journal, driver, journal.plan_digest)
        self.assertEqual(driver.calls, ["verify_acceptance", "open_traffic"])
        self.assertEqual(self.state()["status"], "ROLLED_BACK")

    def test_real_process_kill_leaves_a_valid_journal_and_releases_the_lock(self):
        code = '''
import importlib.util, os, signal, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location("fixture", sys.argv[1])
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
class KilledDriver(fixture.Driver):
    def run(self, operation, bound_plan, evidence):
        if operation == "migrate_and_regenerate":
            os.kill(os.getpid(), signal.SIGKILL)
        return super().run(operation, bound_plan, evidence)
with fixture.module.Journal(Path(sys.argv[2]), fixture.plan()) as journal:
    fixture.module.prepare(journal, KilledDriver())
'''
        child = subprocess.Popen([sys.executable, "-c", code, str(Path(__file__).resolve()), str(self.directory)],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            _, error = child.communicate(timeout=10)
            self.assertEqual(child.returncode, -signal.SIGKILL, error)
        finally:
            if child.poll() is None:
                child.kill()
                child.wait(timeout=5)
        self.assertEqual(self.state()["pending"], "migrate_and_regenerate")
        with module.Journal(self.directory, plan()) as journal:
            driver = Driver()
            module.recover(journal, driver)
        self.assertEqual(driver.calls, list(module.RECOVERY))

    def test_world_readable_journal_is_rejected_before_adapter_use(self):
        self.directory.mkdir(mode=0o755)
        os.chmod(str(self.directory), 0o755)
        with self.assertRaises(module.CutoverError):
            with module.Journal(self.directory, plan()):
                pass


if __name__ == "__main__":
    unittest.main()
