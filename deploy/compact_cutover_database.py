"""Защищённая копия PostgreSQL и доказательство восстановления.

Модуль не имеет production CLI и не останавливает приложение. Host adapter обязан
удерживать общий deployment lock, закрыть трафик и остановить writers. Откат
существующей БД доступен только после доказанного независимого восстановления,
пока host journal разрешает recovery. После возможного открытия трафика запрещён.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import signal
import stat
import subprocess
import time
import uuid

from compact_cutover_state import CutoverError, canonical, require


def local_name(name):
    require(isinstance(name, str) and re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,127}", name),
            "Expected one private artifact name")
    return name


def fsync_directory(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def validate_target(target):
    require(isinstance(target, dict) and set(target) == {"id", "image", "volume"}, "Invalid database binding")
    for field, pattern in {"id": r"[a-f0-9]{64}", "image": r"sha256:[a-f0-9]{64}",
                           "volume": r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}"}.items():
        require(isinstance(target[field], str) and re.fullmatch(pattern, target[field]), "Invalid database " + field)
    return json.loads(canonical(target))


class CommandRunner:
    """Без shell; ограниченные время/вывод; секретные логи остаются локально.

    Убийство Docker CLI не гарантирует остановки docker exec: SQL дополнительно
    ограничен серверным statement_timeout, а PG-команды — timeout в контейнере.
    После прерывания вызывающая сторона обязана снова проверить отсутствие сессий.
    """
    def __init__(self, directory):
        self.directory = Path(directory)
        info = self.directory.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid()
                and info.st_mode & 0o077 == 0, "Artifact directory must be private and owned")
        fsync_directory(self.directory.parent)

    def open_private(self, name):
        fd = os.open(self.directory / local_name(name), os.O_RDONLY | os.O_NOFOLLOW)
        info = os.fstat(fd)
        if not (stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and info.st_mode & 0o077 == 0):
            os.close(fd)
            raise CutoverError("Artifact must be a private owned regular file")
        return os.fdopen(fd, "rb")

    def describe(self, name):
        digest, count = hashlib.sha256(), 0
        with self.open_private(name) as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
                count += len(chunk)
        return {"artifact": name, "sha256": digest.hexdigest(), "bytes": count}

    def verify(self, record):
        require(isinstance(record, dict) and set(record) == {"artifact", "sha256", "bytes"}, "Invalid artifact record")
        require(self.describe(record["artifact"]) == record, "Artifact checksum or size changed")

    def publish_json(self, name, value):
        name = local_name(name)
        temporary = self.directory / (".json-" + uuid.uuid4().hex)
        try:
            fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "wb") as stream:
                stream.write(canonical(value) + b"\n")
                stream.flush()
                os.fsync(stream.fileno())
            # link refuses an existing destination, including a symlink.
            os.link(temporary, self.directory / name)
            fsync_directory(self.directory)
        finally:
            if temporary.exists():
                temporary.unlink()
        return self.describe(name)

    def run(self, args, input_data=None, input_name=None, output_name=None,
            timeout=120, max_bytes=8 * 1024 * 1024):
        require(isinstance(args, list) and args and all(isinstance(x, str) and "\0" not in x for x in args),
                "Invalid command arguments")
        require(0 < timeout <= 1800 and 0 < max_bytes <= 16 * 1024 ** 3, "Invalid process budget")
        require(input_data is None or input_name is None, "Conflicting command input")
        if output_name is not None:
            local_name(output_name)
            require(not os.path.lexists(str(self.directory / output_name)), "Artifact already exists")
        token = uuid.uuid4().hex
        temporary = self.directory / (".output-" + token)
        input_temporary = self.directory / (".input-" + token)
        process, source, sink, errors = None, None, None, None
        selector, chunks = selectors.DefaultSelector(), []
        failed = False
        try:
            if input_data is not None:
                require(isinstance(input_data, bytes) and len(input_data) <= 65536, "Input must be bounded bytes")
                fd = os.open(input_temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, "wb") as stream:
                    stream.write(input_data)
                source = open(input_temporary, "rb")
            elif input_name is not None:
                source = self.open_private(input_name)
            if output_name is not None:
                fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                sink = os.fdopen(fd, "wb")
            error_path = self.directory / ("command-" + token + ".stderr")
            errors = os.fdopen(os.open(error_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb")
            process = subprocess.Popen(args, stdin=source if source is not None else subprocess.DEVNULL,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
            selector.register(process.stdout, selectors.EVENT_READ, "out")
            selector.register(process.stderr, selectors.EVENT_READ, "err")
            deadline = time.monotonic() + timeout
            totals = {"out": 0, "err": 0}
            while selector.get_map():
                require(time.monotonic() < deadline, "Command exceeded its deadline")
                for key, _ in selector.select(min(0.1, max(0, deadline - time.monotonic()))):
                    chunk = os.read(key.fileobj.fileno(), 65536)
                    if not chunk:
                        selector.unregister(key.fileobj)
                        continue
                    kind = key.data
                    totals[kind] += len(chunk)
                    require(totals[kind] <= (max_bytes if kind == "out" else 8 * 1024 * 1024),
                            "Command exceeded its output budget")
                    if kind == "err":
                        errors.write(chunk)
                    elif sink is not None:
                        sink.write(chunk)
                    else:
                        chunks.append(chunk)
            process.wait(timeout=max(0.01, deadline - time.monotonic()))
            require(process.returncode == 0, "Command failed; private stderr retained")
            if sink is not None:
                sink.flush()
                os.fsync(sink.fileno())
                sink.close()
                sink = None
                os.link(temporary, self.directory / output_name)
                fsync_directory(self.directory)
                return self.describe(output_name)
            return b"".join(chunks)
        except (OSError, subprocess.TimeoutExpired):
            failed = True
            raise CutoverError("Command could not complete; private stderr retained") from None
        except BaseException:
            failed = True
            raise
        finally:
            if failed and process is not None:
                # Descendants can retain pipes after their parent has exited.
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    process.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    pass
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait(timeout=2)
            selector.close()
            if process is not None:
                process.stdout.close()
                process.stderr.close()
            for stream in (source, sink, errors):
                if stream is not None:
                    stream.close()
            for path in (temporary, input_temporary):
                if path.exists():
                    path.unlink()


class DatabaseBackup:
    def __init__(self, runner, target, docker=None):
        self.runner = runner
        self.target = validate_target(target)
        self.docker = docker or shutil.which("docker")
        require(self.docker is not None and os.path.isabs(self.docker), "Docker executable is unavailable")

    def command(self, args, **options):
        return self.runner.run([self.docker] + args, **options)

    def inspect(self):
        values = json.loads(self.command(["inspect", self.target["id"]]))
        require(isinstance(values, list) and len(values) == 1, "Database container disappeared")
        info = values[0]
        require(info["Id"] == self.target["id"] and info["Image"] == self.target["image"], "Database identity changed")
        mounts = [m for m in info["Mounts"] if m["Destination"] == "/var/lib/postgresql/data"]
        require(len(mounts) == 1 and mounts[0]["Type"] == "volume"
                and mounts[0]["Name"] == self.target["volume"], "Database data volume changed")
        require(info["State"]["Running"] and not info["State"].get("OOMKilled"), "Database is not running")
        return info

    def pg(self, args, seconds=300, **options):
        self.inspect()
        return self.command(["exec", "-i", "-e", "PGOPTIONS=-c statement_timeout=90000", self.target["id"],
                             "timeout", "-s", "TERM", "-k", "5", str(seconds)] + args,
                            timeout=seconds + 10, **options)

    def sql(self, query, database="tasktopia", **options):
        require(database in ("tasktopia", "postgres"), "Unexpected PostgreSQL control database")
        wrapped = ("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL timezone='UTC'; "
                   "SET LOCAL DateStyle='ISO, YMD'; " + query + "; ROLLBACK;\n").encode()
        return self.pg(["psql", "-X", "-q", "-At", "-U", "tasktopia", "-d", database,
                        "-v", "ON_ERROR_STOP=1"], input_data=wrapped, **options)

    def json(self, query, database="tasktopia"):
        return json.loads(self.sql(query, database=database))

    def assert_quiescent(self, allow_missing=False):
        # Не завершать неизвестные сессии: они означают, что freeze неполон.
        # Control DB остаётся доступна после прерывания между DROP и CREATE.
        # Другой pg_restore может ещё быть подключён к postgres, не к tasktopia.
        activity = self.json("SELECT jsonb_build_object('sessions', (SELECT count(*) FROM pg_stat_activity "
                             "WHERE datname IN ('tasktopia','postgres') AND pid<>pg_backend_pid() AND backend_type='client backend'), "
                             "'prepared', (SELECT count(*) FROM pg_prepared_xacts WHERE database IN ('tasktopia','postgres')), "
                             "'subscriptions', (SELECT count(*) FROM pg_subscription WHERE subenabled), "
                             "'replica',pg_is_in_recovery(), 'exists', EXISTS (SELECT 1 FROM pg_database WHERE datname='tasktopia'))",
                             database="postgres")
        exists = activity.pop("exists")
        require(activity == {"sessions": 0, "prepared": 0, "subscriptions": 0, "replica": False},
                "Unknown database writers, replication or prepared transactions")
        require(exists or allow_missing, "Source database is missing")
        if not exists:
            return
        require(self.json("SELECT to_jsonb(count(*)) FROM pg_extension WHERE extname<>'plpgsql'") == 0,
                "Unknown database extension")
        if self.json("SELECT to_jsonb(to_regclass('public.world_generation_jobs_v1') IS NOT NULL)"):
            require(self.json("SELECT to_jsonb(count(*)) FROM world_generation_jobs_v1 WHERE status IN ('PENDING','RUNNING')") == 0,
                    "Generation jobs are not drained")

    def snapshot(self):
        self.assert_quiescent()
        require(self.json("SELECT to_jsonb(count(*)) FROM pg_largeobject_metadata") == 0, "Large objects require a separate verification contract")
        meta = self.json("SELECT jsonb_build_object('version',current_setting('server_version_num'),"
                         "'encoding',pg_encoding_to_char(encoding),'collate',datcollate,'ctype',datctype,"
                         "'owner',pg_get_userbyid(datdba),'acl',datacl) FROM pg_database WHERE datname=current_database()")
        require(160000 <= int(meta["version"]) < 170000, "This backup contract requires PostgreSQL 16")
        tables = self.json("SELECT COALESCE(jsonb_agg(tablename ORDER BY tablename),'[]') FROM pg_tables WHERE schemaname='public'")
        extra = self.json("SELECT to_jsonb(count(*)) FROM pg_tables WHERE schemaname NOT IN ('public','pg_catalog','information_schema')")
        require(extra == 0, "Unexpected application schema")
        result = {"metadata": meta, "tables": {}, "sequences": {}}
        for table in tables:
            require(re.fullmatch(r"[a-z_][a-z_0-9]*", table), "Unexpected table identifier")
            name = "scan-" + uuid.uuid4().hex
            self.sql('SELECT to_jsonb(t)::text FROM public."' + table + '" t ORDER BY to_jsonb(t)::text COLLATE "C"',
                     output_name=name, max_bytes=1024 ** 3)
            digest, count = hashlib.sha256(), 0
            with self.runner.open_private(name) as stream:
                while True:
                    line = stream.readline(32 * 1024 * 1024 + 1)
                    if not line:
                        break
                    require(len(line) <= 32 * 1024 * 1024 and line.endswith(b"\n"), "Database row exceeds verification budget")
                    row = line[:-1]
                    digest.update(str(len(row)).encode() + b":" + row + b"\n")
                    count += 1
            (self.runner.directory / name).unlink()
            result["tables"][table] = {"count": count, "sha256": digest.hexdigest()}
        sequences = self.json("SELECT COALESCE(jsonb_agg(sequencename ORDER BY sequencename),'[]') FROM pg_sequences WHERE schemaname='public'")
        for sequence in sequences:
            require(re.fullmatch(r"[a-z_][a-z_0-9]*", sequence), "Unexpected sequence identifier")
            result["sequences"][sequence] = self.json("SELECT jsonb_build_object('last_value',last_value::text,'is_called',is_called) FROM public.\"" + sequence + '"')
        schema = self.pg(["pg_dump", "-U", "tasktopia", "-d", "tasktopia", "--schema-only", "--create"], max_bytes=16 * 1024 ** 2)
        # PG 16.14 emits fresh psql \restrict keys; they are not database state.
        schema = b"\n".join(line for line in schema.splitlines() if not line.startswith((b"\\restrict ", b"\\unrestrict ")))
        result["schemaSha256"] = hashlib.sha256(schema).hexdigest()
        self.assert_quiescent()
        return result

    def capture(self):
        self.assert_quiescent()
        size = self.json("SELECT to_jsonb(pg_database_size(current_database()))")
        free = shutil.disk_usage(str(self.runner.directory)).free
        require(free >= max(2 * 1024 ** 3, size * 2), "Insufficient backup space")
        before = self.snapshot()
        baseline = self.runner.publish_json("database-baseline.json", before)
        archive = self.pg(["pg_dump", "-U", "tasktopia", "-d", "tasktopia", "--format=custom", "--create"],
                          output_name="database.dump", max_bytes=min(16 * 1024 ** 3, free - 1024 ** 3), seconds=900)
        require(self.snapshot() == before, "Database changed while taking backup")
        record = {"version": 1, "source": self.target, "archive": archive, "baseline": baseline}
        self.runner.publish_json("database-backup.json", record)
        return record

    def verify_record(self, record):
        require(isinstance(record, dict) and set(record) == {"version", "source", "archive", "baseline"}
                and type(record["version"]) is int and record["version"] == 1
                and record["source"] == self.target, "Backup belongs to another database")
        self.runner.verify(record["archive"])
        self.runner.verify(record["baseline"])
        with self.runner.open_private(record["archive"]["artifact"]) as stream:
            require(stream.read(5) == b"PGDMP", "Not a custom PostgreSQL archive")
        with self.runner.open_private(record["baseline"]["artifact"]) as stream:
            data = stream.read(1024 * 1024 + 1)
        require(len(data) <= 1024 * 1024, "Baseline exceeds verification budget")
        return json.loads(data)

    def prove_restore(self, record):
        baseline = self.verify_record(record)
        token = uuid.uuid4().hex
        name = "tasktopia-cutover-proof-" + token
        ownership = {"name": name, "image": self.target["image"], "label": token}
        # Durable intent before Docker creates anything; never adopt an existing name.
        self.runner.publish_json("proof-intent-" + token + ".json", ownership)
        require(not self.command(["ps", "-aq", "--filter", "name=^/" + name + "$"]).strip(), "Proof container name already exists")
        created = False
        destination = None
        try:
            container_id = self.command(["create", "--name", name, "--label", "tasktopia.cutover-proof=" + token,
                "--network", "none", "--no-healthcheck", "--log-driver", "none", "--cpus", "2", "--memory", "1g",
                "--pids-limit", "128", "-e", "POSTGRES_USER=tasktopia", "-e", "POSTGRES_DB=postgres",
                "-e", "POSTGRES_HOST_AUTH_METHOD=trust", self.target["image"]]).decode().strip()
            created = True
            info = self._proof_info(name, token)
            require(info["Id"] == container_id, "Proof container identity changed")
            destination = {"id": container_id, "image": self.target["image"], "volume": info["Mounts"][0]["Name"]}
            self.runner.publish_json("proof-created-" + token + ".json", destination)
            self.command(["start", container_id])
            ready = False
            for _ in range(60):
                try:
                    # The image's temporary init server listens on a Unix socket
                    # before shutting down. Only TCP proves the final server ready.
                    self.command(["exec", container_id, "pg_isready", "-h", "127.0.0.1", "-U", "tasktopia", "-d", "postgres"], timeout=5)
                    ready = True
                    break
                except CutoverError:
                    time.sleep(0.25)
            require(ready, "Proof database did not become ready")
            self._proof_info(name, token)
            disk = self.command(["exec", container_id, "df", "-Pk", "/var/lib/postgresql/data"]).decode().splitlines()
            require(len(disk) >= 2 and int(disk[-1].split()[3]) * 1024 >= max(2 * 1024 ** 3, record["archive"]["bytes"] * 4),
                    "Insufficient space for independent restore")
            candidate = DatabaseBackup(self.runner, destination, self.docker)
            # Only the freshly created, exact labelled container reaches pg_restore.
            candidate.pg(["pg_restore", "--exit-on-error", "--create", "-U", "tasktopia", "-d", "postgres"],
                         input_name=record["archive"]["artifact"], seconds=900)
            restored = candidate.snapshot()
            require(restored == baseline, "Restored schema, rows, sequences or metadata differ")
            self.verify_record(record)
            proof = {"version": 1, "backup": record, "destination": destination,
                     "restoredSnapshotSha256": hashlib.sha256(canonical(restored)).hexdigest()}
        finally:
            # A failed/uncertain create can still leave a container. Resolve only our
            # random name + label + image; never stop a preexisting named resource.
            if created or self.command(["ps", "-aq", "--filter", "name=^/" + name + "$"]).strip():
                info = self._proof_info(name, token)
                if info["State"]["Running"]:
                    self.command(["stop", "--time", "15", info["Id"]], timeout=25)
                require(not self._proof_info(name, token)["State"]["Running"], "Proof container cleanup failed")
        # Publish passed proof only after verified cleanup. Preserve container/volume.
        self.runner.publish_json("database-restore-proof.json", proof)
        return proof

    def restore_verified(self, record, proof_artifact):
        """Разрушительный шаг для host journal RECOVERING/restore_database.

        Вызывающая сторона проверяет состояние журнала, freeze и общий lock.
        Никакого FORCE при удалении БД: возникшая чужая сессия остановит операцию.
        Ошибка означает неопределённый результат, а не право запустить старый app.
        Возврат возможен только после полного сравнения с исходным snapshot.
        """
        baseline = self.verify_record(record)
        self.runner.verify(proof_artifact)
        with self.runner.open_private(proof_artifact["artifact"]) as stream:
            encoded = stream.read(1024 * 1024 + 1)
        require(len(encoded) <= 1024 * 1024, "Restore proof exceeds verification budget")
        proof = json.loads(encoded)
        require(isinstance(proof, dict) and set(proof) == {"version", "backup", "destination", "restoredSnapshotSha256"}
                and type(proof["version"]) is int and proof["version"] == 1 and proof["backup"] == record
                and proof["restoredSnapshotSha256"] == hashlib.sha256(canonical(baseline)).hexdigest(),
                "Restore proof does not match this backup")
        destination = validate_target(proof["destination"])
        require(destination["id"] != self.target["id"] and destination["volume"] != self.target["volume"]
                and destination["image"] == self.target["image"], "Restore proof is not independent")
        self.assert_quiescent(allow_missing=True)
        self.pg(["pg_restore", "--exit-on-error", "--clean", "--if-exists", "--create",
                 "-U", "tasktopia", "-d", "postgres"], input_name=record["archive"]["artifact"], seconds=900)
        require(self.snapshot() == baseline, "In-place recovery did not restore the baseline")
        self.verify_record(record)
        return {"source": self.target, "proof": proof_artifact,
                "snapshotSha256": hashlib.sha256(canonical(baseline)).hexdigest()}

    def _proof_info(self, name, token):
        values = json.loads(self.command(["inspect", name]))
        require(len(values) == 1, "Proof container is missing")
        info = values[0]
        require(info["Name"] == "/" + name and info["Image"] == self.target["image"]
                and info["Config"]["Labels"].get("tasktopia.cutover-proof") == token, "Not an owned proof container")
        require(info["HostConfig"]["NetworkMode"] == "none" and not info["HostConfig"].get("PortBindings"),
                "Proof database must have no network or published ports")
        mounts = info["Mounts"]
        require(len(mounts) == 1 and mounts[0]["Type"] == "volume"
                and mounts[0]["Destination"] == "/var/lib/postgresql/data"
                and mounts[0]["Name"] != self.target["volume"], "Proof must use a new independent data volume")
        return info
