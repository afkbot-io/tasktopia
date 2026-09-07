"""Проверки исполняемых границ backup/restore без доступа к production."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "deploy"))
from compact_cutover_database import CommandRunner, DatabaseBackup, validate_target
from compact_cutover_state import CutoverError, canonical


class BackupBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)
        self.runner = CommandRunner(self.directory)

    def tearDown(self):
        self.temporary.cleanup()

    def test_streams_private_output_and_returns_verified_digest(self):
        result = self.runner.run([sys.executable, "-c", "import sys;sys.stdout.buffer.write(b'x'*2000000)"],
                                 output_name="dump.bin", max_bytes=3000000)
        self.assertEqual(result["sha256"], hashlib.sha256(b"x" * 2000000).hexdigest())
        self.assertEqual(result["bytes"], 2000000)
        self.assertEqual((self.directory / "dump.bin").stat().st_mode & 0o777, 0o600)

    def test_failure_never_publishes_an_archive_or_leaks_stderr(self):
        with self.assertRaises(CutoverError) as error:
            self.runner.run([sys.executable, "-c", "import sys;print('partial');sys.stderr.write('SECRET');sys.exit(3)"],
                            output_name="dump.bin")
        self.assertNotIn("SECRET", str(error.exception))
        self.assertFalse((self.directory / "dump.bin").exists())

    def test_output_limit_and_timeout_stop_real_processes(self):
        for program, options in [
            ("import sys;sys.stdout.write('x'*1000000)", {"max_bytes": 100}),
            ("import time;time.sleep(30)", {"timeout": 0.15}),
        ]:
            started = time.monotonic()
            with self.assertRaises(CutoverError):
                self.runner.run([sys.executable, "-c", program], output_name="dump.bin", **options)
            self.assertLess(time.monotonic() - started, 4)
            self.assertFalse((self.directory / "dump.bin").exists())

    def test_refuses_symlinks_existing_files_and_path_escape(self):
        (self.directory / "existing").write_bytes(b"preserve")
        (self.directory / "link").symlink_to(self.directory / "existing")
        for name in ["existing", "link", "../escaped", "/tmp/escaped"]:
            with self.assertRaises((CutoverError, FileExistsError)):
                self.runner.run([sys.executable, "-c", "print('overwrite')"], output_name=name)
        self.assertEqual((self.directory / "existing").read_bytes(), b"preserve")

    def test_exact_container_image_and_volume_are_required(self):
        target = {"id": "a" * 64, "image": "sha256:" + "b" * 64, "volume": "tasktopia_postgres"}
        self.assertEqual(validate_target(target), target)
        for field, value in [("id", "postgres"), ("image", "postgres:16-alpine"),
                             ("volume", "../data"), ("id", "a" * 12)]:
            with self.assertRaises(CutoverError):
                validate_target(dict(target, **{field: value}))

    def test_proof_cannot_accept_modified_backup_or_baseline(self):
        archive = self.directory / "backup.dump"
        archive.write_bytes(b"PGDMP-test")
        archive.chmod(0o600)
        baseline = self.directory / "baseline.json"
        baseline.write_text(json.dumps({"tables": {}}))
        baseline.chmod(0o600)
        binding = {"id": "a" * 64, "image": "sha256:" + "b" * 64, "volume": "tasktopia_postgres"}
        record = {"version": 1, "source": binding,
                  "archive": self.runner.describe("backup.dump"),
                  "baseline": self.runner.describe("baseline.json")}
        backup = DatabaseBackup(self.runner, binding, "/unused/docker")
        backup.verify_record(record)
        archive.write_bytes(b"PGDMP-changed")
        with self.assertRaises(CutoverError):
            backup.verify_record(record)

    def test_recovery_rejects_unrelated_or_non_independent_proof_before_docker(self):
        class NoExternalCommands(DatabaseBackup):
            def command(self, *args, **options):
                raise AssertionError("Invalid recovery attempted an external command")
        binding = {"id": "a" * 64, "image": "sha256:" + "b" * 64, "volume": "source_volume"}
        baseline = {"tables": {}}
        (self.directory / "backup.dump").write_bytes(b"PGDMP-test")
        (self.directory / "backup.dump").chmod(0o600)
        record = {"version": 1, "source": binding, "archive": self.runner.describe("backup.dump"),
                  "baseline": self.runner.publish_json("baseline.json", baseline)}
        good = {"version": 1, "backup": record,
                "destination": dict(binding, id="c" * 64, volume="proof_volume"),
                "restoredSnapshotSha256": hashlib.sha256(canonical(baseline)).hexdigest()}
        variants = [dict(good, restoredSnapshotSha256="0" * 64),
                    dict(good, destination=binding),
                    dict(good, destination=dict(good["destination"], volume="source_volume")),
                    dict(good, backup=dict(record, source=dict(binding, id="d" * 64)))]
        # An explicit absolute unused executable avoids depending on Docker installation.
        database = NoExternalCommands(self.runner, binding, "/unused/docker")
        for index, proof in enumerate(variants):
            artifact = self.runner.publish_json("proof-{}.json".format(index), proof)
            with self.assertRaises(CutoverError):
                database.restore_verified(record, artifact)


if __name__ == "__main__":
    unittest.main()
