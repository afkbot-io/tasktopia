"""Явно запускаемая Docker-репетиция. Только новые контейнеры/тома, без портов.

python3 tests/compact_cutover_database_integration.py --pg-image sha256:<digest>
Опционально: --archive <private.dump> --archive-sha256 <digest>.
Архив читается, но не изменяется; все созданные контейнеры останавливаются.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "deploy"))
from compact_cutover_database import CommandRunner, DatabaseBackup
from compact_cutover_state import CutoverError, canonical, require


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pg-image", required=True)
    parser.add_argument("--archive")
    parser.add_argument("--archive-sha256")
    args = parser.parse_args()
    require(re.fullmatch(r"sha256:[a-f0-9]{64}", args.pg_image), "An immutable PostgreSQL image is required")
    require(bool(args.archive) == bool(args.archive_sha256), "Archive needs its exact checksum")
    root = Path(__file__).resolve().parents[1]
    (root / "tmp").mkdir(mode=0o700, exist_ok=True)
    directory = Path(tempfile.mkdtemp(prefix="cutover-database-", dir=str(root / "tmp")))
    runner = CommandRunner(directory)
    token = uuid.uuid4().hex
    name = "tasktopia-cutover-fixture-" + token
    import shutil
    docker = shutil.which("docker")
    require(docker is not None, "Docker is required for this explicit integration test")
    owned = False
    report = {"production": False, "directory": str(directory), "status": "running", "pgImage": args.pg_image}

    def command(values, **options):
        return runner.run([docker] + values, **options)

    def inspect():
        value = json.loads(command(["inspect", name]))[0]
        require(value["Name"] == "/" + name and value["Image"] == args.pg_image
                and value["Config"]["Labels"].get("tasktopia.cutover-fixture") == token, "Not our fixture")
        require(value["HostConfig"]["NetworkMode"] == "none" and not value["HostConfig"].get("PortBindings"), "Fixture is not isolated")
        require(len(value["Mounts"]) == 1 and value["Mounts"][0]["Type"] == "volume", "Fixture must have a new volume")
        return value

    try:
        print(json.dumps({"phase": "new-isolated-fixture", "directory": str(directory)}), flush=True)
        require(not command(["ps", "-aq", "--filter", "name=^/" + name + "$"]).strip(), "Fixture name is occupied")
        runner.publish_json("fixture-intent.json", {"name": name, "token": token, "image": args.pg_image})
        container_id = command(["create", "--name", name, "--label", "tasktopia.cutover-fixture=" + token,
            "--network", "none", "--no-healthcheck", "--log-driver", "none", "--cpus", "2", "--memory", "1g",
            "--pids-limit", "128", "-e", "POSTGRES_USER=tasktopia", "-e", "POSTGRES_DB=tasktopia",
            "-e", "POSTGRES_HOST_AUTH_METHOD=trust", args.pg_image]).decode().strip()
        owned = True
        info = inspect()
        require(info["Id"] == container_id, "Fixture identity changed")
        target = {"id": container_id, "image": args.pg_image, "volume": info["Mounts"][0]["Name"]}
        report["source"] = target
        command(["start", container_id])
        ready = False
        for _ in range(60):
            try:
                command(["exec", container_id, "pg_isready", "-h", "127.0.0.1", "-U", "tasktopia", "-d", "tasktopia"], timeout=5)
                ready = True
                break
            except CutoverError:
                time.sleep(0.25)
        require(ready, "Fixture failed to start")
        database = DatabaseBackup(runner, target, docker)

        def fixture_sql(query):
            inspect()
            return database.pg(["psql", "-X", "-q", "-At", "-U", "tasktopia", "-d", "tasktopia", "-v", "ON_ERROR_STOP=1"],
                               input_data=query.encode())

        if args.archive:
            source = Path(args.archive)
            require(source.is_absolute() and not source.is_symlink() and source.is_file()
                    and source.stat().st_uid == os.getuid() and source.stat().st_mode & 0o077 == 0,
                    "Expected a private owned archive")
            require(re.fullmatch(r"[a-f0-9]{64}", args.archive_sha256), "Invalid archive checksum")
            digest = hashlib.sha256()
            # Copy a read-only source into this run's directory; never restore into its original container.
            fd = os.open(directory / "seed.dump", os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            with source.open("rb") as input_stream, os.fdopen(fd, "wb") as output:
                for chunk in iter(lambda: input_stream.read(1024 * 1024), b""):
                    digest.update(chunk)
                    output.write(chunk)
            require(digest.hexdigest() == args.archive_sha256, "Source archive checksum differs")
            database.pg(["pg_restore", "--exit-on-error", "-U", "tasktopia", "-d", "tasktopia"], input_name="seed.dump", seconds=900)
            report["seedArchiveSha256"] = digest.hexdigest()
        else:
            fixture_sql("CREATE TABLE sample(id bigserial PRIMARY KEY, body text NOT NULL); "
                        "INSERT INTO sample(body) VALUES (E'строка\\nвторая'), ('quotation '' and tab'), ('same'), ('same'); "
                        "CREATE SEQUENCE unused_seq; CREATE VIEW sample_view AS SELECT id,body FROM sample; "
                        "CREATE TABLE world_generation_jobs_v1(status text); INSERT INTO world_generation_jobs_v1 VALUES ('PENDING');")
            try:
                database.assert_quiescent()
                raise AssertionError("An undrained generation job was accepted")
            except CutoverError:
                report["pendingJobRejected"] = True
            database.assert_quiescent(restoring=True)
            report["stoppedPendingJobAllowsRecoveryOnly"] = True
            fixture_sql("DELETE FROM world_generation_jobs_v1;")
            # An actual second DB connection, not a mocked pg_stat_activity row.
            client = subprocess.Popen([docker, "exec", container_id, "timeout", "-s", "TERM", "-k", "2", "10",
                "psql", "-X", "-q", "-U", "tasktopia", "-d", "tasktopia", "-c", "SELECT pg_sleep(5)"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                visible = False
                for _ in range(20):
                    if database.json("SELECT to_jsonb(count(*)) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()"):
                        visible = True
                        break
                    time.sleep(0.1)
                require(visible, "Concurrent-client fixture did not connect")
                try:
                    database.assert_quiescent()
                    raise AssertionError("An existing database client was ignored")
                except CutoverError:
                    report["concurrentClientRejected"] = True
            finally:
                client.wait(timeout=15)
            baseline = database.snapshot()
            for mutation in ["UPDATE sample SET body='changed' WHERE id=1;",
                             "SELECT nextval('unused_seq');", "CREATE INDEX body_idx ON sample(body);"]:
                fixture_sql(mutation)
                require(database.snapshot() != baseline, "A changed row/sequence/schema was not detected")
                baseline = database.snapshot()
            report["rowSequenceSchemaDriftDetected"] = True
        print(json.dumps({"phase": "capture-and-independent-restore", "directory": str(directory)}), flush=True)
        record = database.capture()
        proof = database.prove_restore(record)
        restored = database.verify_record(record)
        require(database.snapshot() == restored, "Source database changed during independent proof")
        if args.archive:
            fixture_sql("CREATE TABLE cutover_recovery_fixture(value text); "
                        "INSERT INTO cutover_recovery_fixture VALUES ('local rehearsal only'); "
                        "UPDATE tasks_v3 SET title='LOCAL RECOVERY REHEARSAL ONLY' WHERE id=(SELECT id FROM tasks_v3 ORDER BY id LIMIT 1); "
                        "SELECT nextval('events_id_seq');")
        else:
            fixture_sql("ALTER TABLE sample ADD COLUMN migrated text; DELETE FROM sample WHERE id=1; SELECT nextval('unused_seq');")
        require(database.snapshot() != restored, "Rollback fixture did not change")
        print(json.dumps({"phase": "in-place-recovery-and-repeat", "directory": str(directory)}), flush=True)
        database.restore_verified(record, runner.describe("database-restore-proof.json"))
        require(database.snapshot() == restored, "In-place rollback did not restore the full baseline")
        # Repeating recovery is allowed while the host has kept traffic closed.
        database.restore_verified(record, runner.describe("database-restore-proof.json"))
        require(database.snapshot() == restored, "Repeated in-place rollback changed baseline")
        report["inPlaceRecoveryAndRepeatPassed"] = True
        if not args.archive:
            # Simulate an interrupted --clean --create between DROP and CREATE.
            database.pg(["psql", "-X", "-q", "-U", "tasktopia", "-d", "postgres", "-v", "ON_ERROR_STOP=1",
                         "-c", "DROP DATABASE tasktopia"])
            database.restore_verified(record, runner.describe("database-restore-proof.json"))
            require(database.snapshot() == restored, "Recovery failed after database disappeared")
            report["recoveryAfterDropPassed"] = True
            # A real pg_restore failure must stop its new container and never
            # publish a successful proof, even when the corrupt file's hash matches.
            broken_dir = directory / "broken-proof"
            broken_dir.mkdir(mode=0o700)
            broken_runner = CommandRunner(broken_dir)
            with runner.open_private(record["archive"]["artifact"]) as source:
                fd = os.open(broken_dir / "broken.dump", os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                with os.fdopen(fd, "wb") as output:
                    output.write(source.read(32))
            bad_record = dict(record, archive=broken_runner.describe("broken.dump"),
                              baseline=broken_runner.publish_json("baseline.json", restored))
            try:
                DatabaseBackup(broken_runner, target, docker).prove_restore(bad_record)
                raise AssertionError("A truncated archive was restored successfully")
            except CutoverError:
                require(not (broken_dir / "database-restore-proof.json").exists(), "Failed restore published proof")
                intents = list(broken_dir.glob("proof-intent-*.json"))
                require(len(intents) == 1, "Expected one actual restore attempt")
                intent = json.loads(intents[0].read_text())
                failed_container = json.loads(command(["inspect", intent["name"]]))[0]
                require(not failed_container["State"]["Running"], "Failed restore container was not stopped")
                report["failedRestoreStoppedAndNotAccepted"] = True
        report.update({"status": "passed", "tables": len(restored["tables"]),
                       "rows": sum(value["count"] for value in restored["tables"].values()),
                       "sequences": len(restored["sequences"]), "backup": record,
                       "proof": proof, "snapshotSha256": hashlib.sha256(canonical(restored)).hexdigest()})
    except BaseException:
        report["status"] = "failed"
        raise
    finally:
        if owned or command(["ps", "-aq", "--filter", "name=^/" + name + "$"]).strip():
            info = inspect()
            if info["State"]["Running"]:
                command(["stop", "--time", "15", info["Id"]], timeout=25)
            require(not inspect()["State"]["Running"], "Fixture cleanup failed")
        report["resourcesPreserved"] = True
        runner.publish_json("integration-report.json", report)
        print(json.dumps({key: report[key] for key in ("status", "directory", "production", "resourcesPreserved")}), flush=True)


if __name__ == "__main__":
    main()
