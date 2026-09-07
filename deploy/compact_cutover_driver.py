"""Первый compact cutover через updater: prepare, recover, accept.

Только установленный tasktopia.online; не универсальный shell hook runner.
Все команды/секретные результаты сохраняются локально в private run directory.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import time
import traceback
import uuid

from compact_cutover_conservation import capture_business, verify_business
from compact_cutover_database import CommandRunner, DatabaseBackup, fsync_directory
from compact_cutover_files import FileBackup, file_hash, inventory
from compact_cutover_host import DeploymentLock, NginxMaintenance, WriterFreeze
from compact_cutover_state import CutoverError, Journal, accept, canonical, prepare, recover, require

APP = Path("/srv/tasktopia/app")
STATIC = Path("/srv/tasktopia/static")
ROLES = ("app", "mcp", "world")


def completed_export(info, image):
    return (bool(re.fullmatch(r"/tasktopia-compact-export-[a-f0-9]{32}", info.get("Name", "")))
            and info.get("Image") == image and info.get("Config", {}).get("Entrypoint") == ["node"]
            and info.get("Config", {}).get("Cmd") == ["dist/synchronize-assets.mjs"]
            and info.get("State", {}).get("Running") is False and info.get("State", {}).get("ExitCode") == 0
            and info.get("HostConfig", {}).get("NetworkMode") == "none"
            and info.get("Mounts") == []
            and info.get("HostConfig", {}).get("RestartPolicy", {}).get("Name") == "no")


def validate_controller(action, revision, plan_revision, recovery_revision, status):
    if revision == plan_revision:
        require(recovery_revision is None, "Recovery override is unnecessary")
        return
    require(recovery_revision == plan_revision and
            ((action == "recover" and status in ("RECOVERY_REQUIRED", "RECOVERING", "PREPARING", "READY"))
             or (action == "accept" and status == "ROLLED_BACK_CLOSED")),
            "Different controller may only recover an explicitly bound prior plan")


def external_compose(source, image):
    result = json.loads(canonical(source))
    for role in ROLES:
        result["services"][role]["image"] = image
        result["services"][role].pop("build", None)
    for kind in ("volumes", "networks"):
        result[kind] = {key: {"name": value["name"], "external": True}
                        for key, value in result.get(kind, {}).items()}
    return result


def validate_cli_log(output, entry, countries):
    rows = []
    for line in output.splitlines():
        try:
            value = json.loads(line)
            if isinstance(value, dict):
                rows.append(value)
        except ValueError:
            continue
    if entry == "regenerate-worlds":
        completed = [v for v in rows if v.get("event") == "world-regeneration.completed"]
        finished = [v for v in rows if v.get("event") == "world-regeneration.finished"]
        require(len(completed) == countries and all(v.get("violationsAfter") == 0 for v in completed)
                and len(finished) == 1 and finished[0].get("countries") == countries,
                "Incomplete or invalid world regeneration")
        require(not any(v.get("event") in ("world-regeneration.failed", "world-regeneration.retrying") for v in rows),
                "World regeneration reported failures")
    else:
        audits = [v for v in rows if isinstance(v.get("violations"), list)]
        require(len(audits) == countries and all(not v["violations"] for v in audits), "Incomplete or invalid world audit")
    return {"countries": countries, "violations": 0}


def read_json(runner, record):
    runner.verify(record)
    with runner.open_private(record["artifact"]) as stream:
        return json.load(stream)


class HostDriver:
    def __init__(self, journal, lock, runner, binding):
        self.j, self.lock, self.r, self.b = journal, lock, runner, binding
        self.docker = shutil.which("docker")
        require(self.docker is not None, "Docker missing")
        self.db = DatabaseBackup(runner, binding["database"], self.docker)
        self.maintenance = NginxMaintenance(journal, lock, runner, binding["nginx"],
                                            shutil.which("nginx"), shutil.which("curl"))
        self.files = FileBackup(runner)

    def command(self, args, **kw):
        return self.r.run([self.docker] + args, **kw)

    def publish(self, value):
        record = self.r.publish_json("step-" + uuid.uuid4().hex + ".json", value)
        return {key: record[key] for key in ("artifact", "sha256")}

    def evidence(self, evidence, name):
        record = self.r.describe(evidence[name]["artifact"])
        require(record["sha256"] == evidence[name]["sha256"], "Step evidence changed")
        return read_json(self.r, record)

    def fixed_binding(self):
        require(self.command(["info", "--format", "{{.ID}}"]).decode().strip() == self.b["daemon"], "Docker host changed")
        require(file_hash(Path(self.b["appDir"]) / ".env") == self.b["envSha256"], "Environment changed during cutover")
        if "environmentBackup" in self.b:
            self.r.verify(self.b["environmentBackup"])
        self.db.inspect()
        for name, source in self.b["volumes"].items():
            info = json.loads(self.command(["volume", "inspect", name]))[0]
            require(info["Mountpoint"] == source and info["Driver"] == "local" and not info.get("Options"), "Volume binding changed")

    def roles(self):
        ids = self.command(["ps", "-aq", "--no-trunc", "--filter", "label=com.docker.compose.project=" + self.j.plan["project"]]).decode().split()
        values = json.loads(self.command(["inspect"] + ids)) if ids else []
        result = {}
        for info in values:
            labels = info["Config"]["Labels"]
            role = labels.get("com.docker.compose.service")
            if role in ROLES:
                require(role not in result and labels.get("com.docker.compose.oneoff", "false").lower() == "false"
                        and labels.get("com.docker.compose.project.working_dir") == self.b["appDir"]
                        and info["Image"] in (self.j.plan["previousImage"], self.j.plan["candidateImage"])
                        and info["HostConfig"]["RestartPolicy"]["Name"] == "unless-stopped", "Unexpected role container")
                record = self.b["previousCompose" if info["Image"] == self.j.plan["previousImage"] else "candidateCompose"]
                definition = read_json(self.r, record)
                service = definition["services"][role]
                env = dict(item.split("=", 1) for item in info["Config"]["Env"])
                require(all(env.get(k) == (None if v is None else str(v)) for k, v in service.get("environment", {}).items()),
                        "Runtime environment changed outside cutover")
                expected_mounts = {(definition["volumes"][m["source"]]["name"], m["target"])
                                   for m in service.get("volumes", []) if m["type"] == "volume"}
                require(all(m["Type"] == "volume" for m in info["Mounts"])
                        and {(m["Name"], m["Destination"]) for m in info["Mounts"]} == expected_mounts,
                        "Runtime volume binding changed")
                require(set(info["NetworkSettings"]["Networks"]) == {self.b["network"]}, "Runtime network changed")
                result[role] = info
            else:
                require(role in ("postgres", "redis") or not info["State"]["Running"], "Unknown project writer")
        return result

    def stop_run_commands(self):
        ids = self.command(["ps", "-aq", "--no-trunc", "--filter", "label=tasktopia.cutover-run=" + self.j.plan["runId"]]).decode().split()
        for ident in ids:
            info = json.loads(self.command(["inspect", ident]))[0]
            require(info["Image"] == self.j.plan["candidateImage"] and
                    info["Config"]["Labels"].get("tasktopia.cutover-run") == self.j.plan["runId"], "Unknown release process")
            if info["State"]["Running"]:
                self.command(["stop", "--time", "15", ident], timeout=25)

    def assert_frozen(self, nginx_record):
        self.fixed_binding()
        self.maintenance.assert_closed(nginx_record)
        roles = self.roles()
        require(all(not info["State"]["Running"] for info in roles.values()), "A runtime writer is still active")
        ids = self.command(["ps", "-q", "--no-trunc"]).decode().split()
        for info in json.loads(self.command(["inspect"] + ids)) if ids else []:
            if info["Id"] == self.b["database"]["id"]:
                continue
            mounted = {m.get("Name") for m in info["Mounts"] if m["Type"] == "volume"}
            require(not mounted.intersection(set(self.b["volumes"]) | {self.b["database"]["volume"]}), "Unknown active volume writer")
        restoring = self.j.state["status"] == "RECOVERING" and self.j.state.get("restoreRequired", False)
        self.db.assert_quiescent(allow_missing=restoring, restoring=restoring)

    def run_cli(self, entry, countries):
        require(entry in ("regenerate-worlds", "audit-worlds"), "Unplanned application command")
        name = "tasktopia-compact-" + uuid.uuid4().hex
        env = read_json(self.r, self.b["candidateCompose"])["services"]["world"]["environment"]
        values = {"NODE_ENV": "production", "RUNTIME_ROLE": "world", "DATABASE_POOL_MAX": "4",
                  "DATABASE_URL": env["DATABASE_URL"], "REDIS_URL": "", "REGENERATION_RUN_ID": self.j.plan["runId"],
                  "REGENERATION_FORCE": "1", "REGENERATION_MAX_ATTEMPTS": "1"}
        require(all("\n" not in str(v) and "\r" not in str(v) for v in values.values()), "Invalid command environment")
        env_name = "cli-" + uuid.uuid4().hex + ".env"
        fd = os.open(self.r.directory / env_name, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(fd, "w") as stream:
            stream.write("".join(k + "=" + str(v) + "\n" for k, v in values.items()))
            stream.flush()
            os.fsync(stream.fileno())
        self.r.publish_json(name + "-intent.json", {"image": self.j.plan["candidateImage"], "entry": entry})
        ident = self.command(["create", "--name", name, "--label", "com.docker.compose.project=tasktopia-cutover-tools",
            "--label", "com.docker.compose.service=cli", "--label", "tasktopia.cutover-run=" + self.j.plan["runId"],
            "--network", self.b["network"], "--read-only", "--tmpfs", "/tmp:rw,nosuid,noexec,size=64m",
            "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--memory", "1536m", "--cpus", "2",
            "--pids-limit", "128", "--env-file", str(self.r.directory / env_name), "--entrypoint", "node",
            self.j.plan["candidateImage"], "dist/" + entry + ".mjs"]).decode().strip()
        try:
            output = self.command(["start", "--attach", ident], timeout=1800, max_bytes=32 * 1024 ** 2)
            info = json.loads(self.command(["inspect", ident]))[0]
            require(info["Image"] == self.j.plan["candidateImage"] and not info["State"]["Running"]
                    and info["State"]["ExitCode"] == 0 and not info["State"].get("OOMKilled"), "CLI failed")
            log = self.r.publish_json(entry + "-" + uuid.uuid4().hex + ".json", {"lines": output.decode().splitlines()})
            return {"log": log, **validate_cli_log(output, entry, countries)}
        finally:
            self.stop_run_commands()

    def switch_static(self, target):
        root = Path(self.b["staticRoot"])
        require(target in (self.j.plan["previousStatic"], self.b["candidateStatic"])
                and Path(target).is_dir() and Path(target).resolve().parent == root / "releases", "Unplanned static target")
        current = root / "current"
        require(current.is_symlink() and str(current.resolve()) in
                (self.j.plan["previousStatic"], self.b["candidateStatic"]), "Static link changed outside cutover")
        temporary = root / (".current-" + uuid.uuid4().hex)
        temporary.symlink_to(target)
        os.replace(temporary, current)
        fsync_directory(root)

    def start_roles(self, previous=False):
        record = self.b["previousCompose" if previous else "candidateCompose"]
        self.r.verify(record)
        self.command(["compose", "--project-directory", self.b["appDir"], "--project-name", self.j.plan["project"],
            "-f", str(self.r.directory / record["artifact"]), "up", "-d", "--no-deps", "--force-recreate", *ROLES], timeout=300)

    def health(self, previous=False):
        expected = self.j.plan["previousImage" if previous else "candidateImage"]
        deadline = time.monotonic() + 180
        while True:
            try:
                roles = self.roles()
                require(set(roles) == set(ROLES) and all(info["Image"] == expected and info["State"]["Running"]
                    and info["State"].get("Health", {}).get("Status") == "healthy" for info in roles.values()), "Roles not healthy")
                for port in self.b["healthPorts"]:
                    self.r.run([shutil.which("curl"), "--disable", "--fail", "--silent", "--show-error", "--noproxy", "*",
                        "--max-time", "5", "http://127.0.0.1:" + str(port) + "/health"], timeout=7)
                return {role: info["Id"] for role, info in roles.items()}
            except CutoverError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(2)

    def run(self, operation, plan, evidence):
        try:
            return self._run(operation, plan, evidence)
        except Exception:
            self.r.publish_json("failure-" + uuid.uuid4().hex + ".json",
                                {"operation": operation, "privateTraceback": traceback.format_exc()})
            raise

    def _run(self, operation, plan, evidence):
        require(plan == self.j.plan and self.lock.fd is not None, "Unlocked or changed plan")
        self.fixed_binding()
        if operation == "inspect":
            nginx = self.maintenance.capture()
            freeze = WriterFreeze(self.j, self.lock, self.r, self.docker, self.maintenance, nginx)
            result = {"nginx": nginx, "writers": freeze.capture(plan["previousImage"])}
        else:
            inspected = self.evidence(evidence, "inspect")
            nginx = inspected["nginx"]
            result = {"operation": operation}
            if operation == "prepare_candidate_assets":
                export = "tasktopia-compact-export-" + uuid.uuid4().hex
                ident = self.command(["create", "--name", export, "--label", "com.docker.compose.project=tasktopia-cutover-tools",
                    "--label", "com.docker.compose.service=export", "--network", "none", "--entrypoint", "node",
                    plan["candidateImage"], "dist/synchronize-assets.mjs"]).decode().strip()
                revision = self.command(["start", "--attach", ident]).decode().strip()
                require(re.fullmatch(r"[a-f0-9]{16}", revision), "Invalid candidate asset revision")
                target = Path(self.b["candidateStatic"])
                require(not target.exists(), "Candidate static already exists")
                target.mkdir(mode=0o755)
                self.command(["cp", ident + ":/app/dist/public/.", str(target)], timeout=300, max_bytes=1024 ** 2)
                for path in [target] + list(target.rglob("*")):
                    os.chmod(path, 0o755 if path.is_dir() else 0o644)
                result = {"assetRevision": revision, "manifestSha256": file_hash(target / "game-assets/v5/manifest.json")}
            elif operation == "enable_maintenance":
                self.maintenance.enable(nginx)
            elif operation == "stop_writers":
                self.maintenance.assert_closed(nginx)
                self.stop_run_commands()
                # Older Compose-built images carried project labels into this
                # completed, network-none export container. Retire only the
                # exact candidate exporter after its static-copy evidence exists.
                if "prepare_candidate_assets" in evidence:
                    self.evidence(evidence, "prepare_candidate_assets")
                    ids = self.command(["ps", "-aq", "--no-trunc", "--filter",
                                        "label=com.docker.compose.project=" + plan["project"]]).decode().split()
                    for info in json.loads(self.command(["inspect"] + ids)) if ids else []:
                        if completed_export(info, plan["candidateImage"]):
                            self.r.publish_json("retired-export-" + uuid.uuid4().hex + ".json",
                                                {"id": info["Id"], "image": info["Image"], "name": info["Name"]})
                            self.command(["rm", info["Id"]])
                if self.j.state["status"] == "PREPARING":
                    WriterFreeze(self.j, self.lock, self.r, self.docker, self.maintenance, nginx).stop(inspected["writers"])
                else:
                    roles = self.roles()
                    if roles:
                        self.command(["stop", "--time", "30"] + [v["Id"] for v in roles.values()], timeout=45)
            elif operation == "assert_frozen":
                self.assert_frozen(nginx)
            elif operation == "backup":
                self.assert_frozen(nginx)
                database = self.db.capture()
                files = [self.files.capture("volume-" + str(i), Path(path)) for i, path in enumerate(self.b["volumes"].values())]
                files.append(self.files.capture("static", Path(plan["previousStatic"])))
                business = self.r.publish_json("business-before.json", capture_business(self.db))
                result = {"database": database, "files": files, "business": business,
                          "countries": self.db.json("SELECT to_jsonb(count(*)) FROM countries")}
            elif operation == "prove_backup_restore":
                backup = self.evidence(evidence, "backup")
                self.db.prove_restore(backup["database"])
                result = {"database": self.r.describe("database-restore-proof.json"),
                          "files": [self.files.prove(record) for record in backup["files"]]}
            elif operation == "migrate_and_regenerate":
                self.assert_frozen(nginx)
                result = self.run_cli("regenerate-worlds", self.evidence(evidence, "backup")["countries"])
            elif operation == "verify_conservation_and_audit":
                self.assert_frozen(nginx)
                backup = self.evidence(evidence, "backup")
                before = read_json(self.r, backup["business"])
                result = verify_business(before, capture_business(self.db, list(before)))
                result["audit"] = self.run_cli("audit-worlds", backup["countries"])
            elif operation == "activate_candidate_assets":
                self.assert_frozen(nginx)
                revision = self.evidence(evidence, "prepare_candidate_assets")["assetRevision"]
                self.r.run(["/bin/bash", "-c", 'source "$1"; prepare_static_release_paths "$2" "$3" "$4" 5 "$5"',
                    "bash", str(Path(self.b["appDir"]) / "deploy/static-release.sh"), self.b["candidateStatic"],
                    plan["previousStatic"], revision, str(self.r.directory / "prepublished.files")], timeout=300)
                self.switch_static(self.b["candidateStatic"])
            elif operation in ("start_candidate_roles", "start_previous_roles"):
                self.maintenance.assert_closed(nginx)
                self.start_roles(previous=operation == "start_previous_roles")
            elif operation in ("smoke_candidate", "smoke_previous"):
                self.maintenance.assert_closed(nginx)
                result = self.health(previous=operation == "smoke_previous")
            elif operation == "verify_backup":
                backup = self.evidence(evidence, "backup")
                self.db.verify_record(backup["database"])
                proof = self.evidence(evidence, "prove_backup_restore")
                self.r.verify(proof["database"])
                for record in backup["files"]:
                    self.files.read(record)
            elif operation == "restore_database":
                self.assert_frozen(nginx)
                result = self.db.restore_verified(self.evidence(evidence, "backup")["database"],
                                                 self.evidence(evidence, "prove_backup_restore")["database"])
            elif operation == "restore_files_and_bindings":
                self.assert_frozen(nginx)
                if "backup" in evidence and "prove_backup_restore" in evidence:
                    for record in self.evidence(evidence, "backup")["files"]:
                        self.files.restore(record)
                self.switch_static(plan["previousStatic"])
            elif operation in ("verify_restored_baseline", "verify_original_baseline"):
                self.assert_frozen(nginx)
                if "backup" in evidence:
                    baseline = self.db.verify_record(self.evidence(evidence, "backup")["database"])
                    require(self.db.snapshot() == baseline, "Recovered database differs")
            elif operation == "verify_acceptance":
                for item in evidence.values():
                    require(self.r.describe(item["artifact"])["sha256"] == item["sha256"], "Acceptance evidence changed")
                self.maintenance.assert_closed(nginx)
                result = self.health(previous=self.j.state["status"] == "ROLLED_BACK_CLOSED")
            elif operation == "open_traffic":
                self.maintenance.open(nginx)
            else:
                raise CutoverError("Unknown host operation")
        print(json.dumps({"step": operation, "status": "passed"}), flush=True)
        return self.publish(result)


def prepare_binding(runner, app, previous_revision, revision, run_id):
    docker = shutil.which("docker")
    env_path = app / ".env"
    require(env_path.is_file() and not env_path.is_symlink() and env_path.stat().st_uid == os.getuid()
            and env_path.stat().st_mode & 0o077 == 0, "Environment must be a private owned regular file")
    shutil.copyfile(env_path, runner.directory / "previous.env")
    (runner.directory / "previous.env").chmod(0o600)
    with (runner.directory / "previous.env").open("rb") as stream:
        os.fsync(stream.fileno())
    def command(args, **kw):
        return runner.run([docker] + args, **kw)
    config = json.loads(command(["compose", "--project-directory", str(app), "-f", str(app / "docker-compose.yml"), "config", "--format", "json"]))
    project = config["name"]
    ids = command(["compose", "--project-directory", str(app), "-f", str(app / "docker-compose.yml"), "ps", "-q", "app", "mcp", "world", "postgres"]).decode().split()
    infos = json.loads(command(["inspect"] + ids))
    roles = {v["Config"]["Labels"]["com.docker.compose.service"]: v for v in infos}
    require(set(roles) == set(ROLES) | {"postgres"}, "Expected exactly four installed roles")
    previous = roles["app"]["Image"]
    require(all(roles[r]["Image"] == previous for r in ROLES), "Mixed previous runtime images")
    for i, role in enumerate(ROLES):
        require(roles[role]["Config"]["Labels"]["com.docker.compose.project.working_dir"] == str(app), "Wrong checkout")
        require(roles[role]["HostConfig"]["PortBindings"] ==
                {"3000/tcp": [{"HostIp": "127.0.0.1", "HostPort": str((3000, 3002, 3003)[i])}]},
                "Runtime must use the verified loopback ports")
    require(config["services"]["app"]["environment"]["APP_ORIGIN"] == "https://tasktopia.online", "Wrong application origin")
    original_yaml = runner.run(["git", "-C", str(app), "show", previous_revision + ":docker-compose.yml"], output_name="previous-compose.yml")
    previous_config = json.loads(command(["compose", "--project-directory", str(app), "--project-name", project,
        "--env-file", str(app / ".env"), "-f", str(runner.directory / original_yaml["artifact"]), "config", "--format", "json"]))
    for role in ROLES:
        actual = dict(item.split("=", 1) for item in roles[role]["Config"]["Env"])
        require(all(actual.get(k) == str(v) for k, v in previous_config["services"][role]["environment"].items()),
                "Previous runtime environment differs from recovery compose")
    previous_compose = runner.publish_json("previous-compose.json", external_compose(previous_config, previous))
    command(["compose", "--project-directory", str(app), "-f", str(app / "docker-compose.yml"), "build", "app"], timeout=1800)
    candidate = json.loads(command(["image", "inspect", config["services"]["app"]["image"]]))[0]["Id"]
    require(previous != candidate, "Candidate image equals previous runtime")
    candidate_compose = runner.publish_json("candidate-compose.json", external_compose(config, candidate))
    pg = roles["postgres"]
    pg_mount = [m for m in pg["Mounts"] if m["Destination"] == "/var/lib/postgresql/data"]
    require(len(pg_mount) == 1 and pg_mount[0]["Type"] == "volume", "Unknown PostgreSQL storage")
    networks = list(pg["NetworkSettings"]["Networks"])
    require(len(networks) == 1, "Unknown PostgreSQL network")
    volumes = {}
    for role in ROLES:
        for mount in roles[role]["Mounts"]:
            require(mount["Type"] == "volume" and mount["Destination"] in
                    ("/data/uploads", "/app/dist/public/game-assets/v5/revisions"), "Unknown runtime storage")
            volumes[mount["Name"]] = mount["Source"]
    previous_static = str((STATIC / "current").resolve())
    require(Path(previous_static).parent == STATIC / "releases" and Path(previous_static).is_dir(), "Unknown static release")
    site = "/etc/nginx/sites-available/tasktopia.online.conf"
    for enabled in Path("/etc/nginx/sites-enabled").iterdir():
        if str(enabled.resolve()) == site:
            continue
        text = enabled.read_text()
        require(not any("127.0.0.1:" + str(p) in text for p in (3000, 3002, 3003)), "Another vhost bypasses maintenance")
    daemon = command(["info", "--format", "{{.ID}}"]).decode().strip()
    binding = {"appDir": str(app), "daemon": daemon, "envSha256": file_hash(app / ".env"), "network": networks[0],
        "database": {"id": pg["Id"], "image": pg["Image"], "volume": pg_mount[0]["Name"]},
        "volumes": volumes, "previousCompose": previous_compose, "candidateCompose": candidate_compose,
        "environmentBackup": runner.describe("previous.env"),
        "staticRoot": str(STATIC), "candidateStatic": str(STATIC / "releases" / run_id), "healthPorts": [3000, 3002, 3003],
        "nginx": {"site": site, "enabled": "/etc/nginx/sites-enabled/tasktopia.online.conf", "prefix": "/etc/nginx",
                  "configuration": "/etc/nginx/nginx.conf", "certRoot": "/etc/letsencrypt", "staticRoot": str(STATIC),
                  "domain": "tasktopia.online", "httpPort": 80, "httpsPort": 443, "caFile": None, "loopbackOnly": False}}
    plan = {"version": 1, "runId": run_id, "project": project, "appDir": str(app), "revision": revision,
            "previousImage": previous, "candidateImage": candidate, "previousStatic": previous_static,
            "database": "tasktopia", "targetId": hashlib.sha256(canonical(binding)).hexdigest()}
    return plan, binding


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "recover", "accept"))
    parser.add_argument("run_id")
    parser.add_argument("--previous-revision")
    parser.add_argument("--plan-digest")
    parser.add_argument("--recovery-revision")
    args = parser.parse_args()
    require(os.getuid() == 0 and Path(__file__).resolve().parent == APP / "deploy", "Use the installed managed target")
    require(re.fullmatch(r"compact-[a-z0-9-]{8,48}", args.run_id), "Invalid run ID")
    revision = os.environ.get("TASKTOPIA_EXPECTED_REVISION", "")
    require(re.fullmatch(r"[a-f0-9]{40}", revision), "Exact expected revision is required")
    os.umask(0o077)
    directory = APP / "backups" / args.run_id
    (APP / "backups").mkdir(mode=0o700, exist_ok=True)
    with DeploymentLock(APP) as lock:
        if args.action == "prepare":
            require(not directory.exists(), "Run already exists; forward resume is forbidden")
            directory.mkdir(mode=0o700)
        require(directory.is_dir() and not directory.is_symlink(), "Missing or unsafe run directory")
        runner = CommandRunner(directory)
        head = runner.run(["git", "-C", str(APP), "rev-parse", "HEAD"]).decode().strip()
        require(head == revision, "Checkout does not match approved revision")
        require(not runner.run(["git", "-C", str(APP), "status", "--porcelain", "--untracked-files=no"]).strip(), "Dirty deployment checkout")
        if args.action == "prepare":
            require(args.previous_revision is not None and re.fullmatch(r"[a-f0-9]{40}", args.previous_revision), "Previous revision required")
            runner.run(["git", "-C", str(APP), "merge-base", "--is-ancestor", args.previous_revision, revision])
            plan, binding = prepare_binding(runner, APP, args.previous_revision, revision, args.run_id)
            runner.publish_json("binding.json", binding)
            runner.publish_json("plan.json", plan)
        else:
            plan = read_json(runner, runner.describe("plan.json"))
            binding = read_json(runner, runner.describe("binding.json"))
        require(plan["targetId"] == hashlib.sha256(canonical(binding)).hexdigest(), "Plan binding changed")
        with Journal(directory / "journal", plan) as journal:
            validate_controller(args.action, revision, plan["revision"], args.recovery_revision, journal.state["status"])
            if plan["revision"] != revision:
                runner.run(["git", "-C", str(APP), "merge-base", "--is-ancestor", plan["revision"], revision])
                runner.publish_json("recovery-controller-" + uuid.uuid4().hex + ".json",
                                    {"revision": revision, "planRevision": plan["revision"], "action": args.action})
            driver = HostDriver(journal, lock, runner, binding)
            if args.action == "prepare":
                prepare(journal, driver)
            elif args.action == "recover":
                recover(journal, driver)
            else:
                accept(journal, driver, args.plan_digest)
            print(json.dumps({"status": journal.state["status"], "planDigest": journal.plan_digest, "runDirectory": str(directory)}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Errors may mention SQL or secrets; only the type is public.
        print(json.dumps({"status": "failed", "errorType": type(error).__name__,
                          "action": "Keep traffic closed; inspect private run artifacts"}), file=sys.stderr)
        sys.exit(1)
