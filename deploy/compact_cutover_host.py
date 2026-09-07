"""Host freeze первого cutover. Библиотека без production CLI.

Общий lock, maintenance и остановка точных контейнеров. Не выполняет миграцию,
переключение образов/static или восстановление uploads. Полный host driver
должен связать эти операции с DB backend и журналом до разрешения релиза.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import time
import uuid

from compact_cutover_database import fsync_directory
from compact_cutover_state import CutoverError, canonical, require


class DeploymentLock:
    def __init__(self, app_dir):
        self.app_dir = Path(app_dir).resolve()
        self.fd = None

    def __enter__(self):
        git_dir = self.app_dir / ".git"
        require(git_dir.is_dir() and not git_dir.is_symlink(), "Expected a normal deployment checkout")
        fd = os.open(git_dir / "tasktopia-update.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            info = os.fstat(fd)
            require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and not info.st_mode & 0o022,
                    "Unsafe deployment lock")
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise CutoverError("Another Tasktopia deployment holds the updater lock") from None
            self.fd = fd
            return self
        except BaseException:
            os.close(fd)
            raise

    def __exit__(self, *_):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None


def maintenance_config(original, domain, token):
    require(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.-]{0,251}[A-Za-z0-9]", domain), "Invalid site domain")
    require(re.fullmatch(r"[a-f0-9]{64}", token), "Invalid maintenance identity")
    line = "    server_name " + domain + ";\n"
    require(original.count("server_name") in (2, 4) and original.count(line) == 2,
            "Expected exactly two canonical server blocks")
    insertion = ('    add_header X-Tasktopia-Maintenance "' + token + '" always;\n'
                 '    add_header Cache-Control "no-store" always;\n'
                 '    add_header Retry-After "120" always;\n'
                 '    return 503;\n')
    return original.replace(line, line + insertion)


class NginxMaintenance:
    """Фиксированные nginx/curl команды, только канонический управляемый site.

    spec полностью привязан к private baseline. Порты/пути параметризованы для
    изолированной проверки; будущий production entrypoint обязан взять их из
    проверенного host inventory, не из произвольных env overrides.
    """
    def __init__(self, journal, lock, runner, spec, nginx, curl):
        self.journal, self.lock, self.runner = journal, lock, runner
        self.spec = json.loads(canonical(spec))
        self.nginx, self.curl = nginx, curl
        require(set(spec) == {"site", "enabled", "prefix", "configuration", "certRoot", "staticRoot",
                              "domain", "httpPort", "httpsPort", "caFile", "loopbackOnly"}, "Unexpected nginx binding")
        for key in ("site", "enabled", "prefix", "configuration", "certRoot", "staticRoot"):
            value = spec[key]
            require(isinstance(value, str) and re.fullmatch(r"/[A-Za-z0-9._/-]+", value)
                    and ".." not in Path(value).parts and len(Path(value).parts) >= 3, "Invalid nginx path")
        require(spec["caFile"] is None or (isinstance(spec["caFile"], str)
                and re.fullmatch(r"/[A-Za-z0-9._/-]+", spec["caFile"])), "Invalid trust file")
        require(all(type(spec[p]) is int and 1 <= spec[p] <= 65535 for p in ("httpPort", "httpsPort"))
                and spec["httpPort"] != spec["httpsPort"], "Invalid nginx ports")
        require(all(os.path.isabs(x) for x in (nginx, curl)), "Expected absolute tool paths")
        require(type(spec["loopbackOnly"]) is bool, "Invalid listen binding")
        maintenance_config(("    server_name " + spec["domain"] + ";\n") * 2, spec["domain"], journal.plan_digest)

    def _locked(self):
        require(self.lock.fd is not None and self.journal.fd is not None
                and str(self.lock.app_dir) == self.journal.plan["appDir"], "Host and journal locks are required")

    def _phase(self, operation, statuses):
        self._locked()
        require(self.journal.state["pending"] == operation and self.journal.state["status"] in statuses,
                "Host operation is not allowed by this journal state")

    def _read_site(self):
        site, enabled = Path(self.spec["site"]), Path(self.spec["enabled"])
        require(enabled.is_symlink() and enabled.resolve() == site.resolve() and not site.is_symlink(),
                "Unexpected enabled nginx site")
        fd = os.open(site, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, "rb") as stream:
            info = os.fstat(stream.fileno())
            require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and not info.st_mode & 0o022,
                    "Nginx site is not safely owned")
            data = stream.read(65537)
        require(len(data) <= 65536, "Oversized nginx site")
        return data.decode(), {"mode": stat.S_IMODE(info.st_mode), "uid": info.st_uid, "gid": info.st_gid}

    def _canonical_sites(self):
        for name in ("nginx-self-host.conf.template", "nginx-self-host-legacy-proxy.conf.template", "nginx-tasktopia.conf"):
            text = (Path(__file__).parent / name).read_text()
            if name == "nginx-tasktopia.conf":
                text = text.replace("tasktopia.online", self.spec["domain"])
                text = text.replace("/srv/tasktopia/static", self.spec["staticRoot"])
            text = text.replace("__DOMAIN__", self.spec["domain"]).replace("__STATIC_DIR__", self.spec["staticRoot"])
            text = text.replace("/etc/letsencrypt", self.spec["certRoot"])
            for old, new in ((80, self.spec["httpPort"]), (443, self.spec["httpsPort"])):
                text = text.replace("listen " + str(old) + ";", "listen " + str(new) + ";")
                text = text.replace("listen [::]:" + str(old), "listen [::]:" + str(new))
                text = text.replace("listen " + str(old) + " ssl", "listen " + str(new) + " ssl")
            if self.spec["loopbackOnly"]:
                for port in (self.spec["httpPort"], self.spec["httpsPort"]):
                    text = text.replace("listen " + str(port), "listen 127.0.0.1:" + str(port))
                text = text.replace("listen [::]:", "listen [::1]:")
            yield text

    def _is_canonical(self, text):
        # Exact installed 2026-08-21 official vhost, reviewed against current:
        # only the separate PWA static location is absent. No custom adoption.
        previous_official = (self.spec["domain"] == "tasktopia.online"
            and self.spec["staticRoot"] == "/srv/tasktopia/static"
            and self.spec["certRoot"] == "/etc/letsencrypt"
            and (self.spec["httpPort"], self.spec["httpsPort"]) == (80, 443)
            and not self.spec["loopbackOnly"]
            and hashlib.sha256(text.encode()).hexdigest()
                == "fe826405068ce80d6c55f17677cfa3987955f4662c8cf6aa947f1664305c8a1d")
        return previous_official or text in tuple(self._canonical_sites())

    def capture(self):
        self._locked()
        original, metadata = self._read_site()
        require(self._is_canonical(original), "Customized nginx site needs separate review")
        record = {"planDigest": self.journal.plan_digest, "spec": self.spec, "original": original,
                  "metadata": metadata, "maintenance": maintenance_config(original, self.spec["domain"], self.journal.plan_digest)}
        return self.runner.publish_json("nginx-baseline.json", record)

    def _record(self, artifact):
        self._locked()
        self.runner.verify(artifact)
        with self.runner.open_private(artifact["artifact"]) as stream:
            data = stream.read(256 * 1024 + 1)
        require(len(data) <= 256 * 1024, "Oversized nginx baseline")
        value = json.loads(data)
        require(set(value) == {"planDigest", "spec", "original", "metadata", "maintenance"}
                and value["planDigest"] == self.journal.plan_digest and value["spec"] == self.spec,
                "Nginx baseline belongs to another cutover")
        require(self._is_canonical(value["original"])
                and value["maintenance"] == maintenance_config(value["original"], self.spec["domain"], self.journal.plan_digest),
                "Nginx baseline changed")
        return value

    def _replace(self, record, text):
        current, metadata = self._read_site()
        require(current in (record["original"], record["maintenance"]) and metadata == record["metadata"],
                "Nginx site changed outside this cutover")
        if current == text:
            return
        site = Path(self.spec["site"])
        temporary = site.parent / (".tasktopia-cutover-" + uuid.uuid4().hex)
        try:
            fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "wb") as stream:
                stream.write(text.encode())
                stream.flush()
                os.fchown(stream.fileno(), metadata["uid"], metadata["gid"])
                os.fchmod(stream.fileno(), metadata["mode"])
                os.fsync(stream.fileno())
            os.replace(temporary, site)
            fsync_directory(site.parent)
        finally:
            if temporary.exists():
                temporary.unlink()

    def _reload(self):
        args = [self.nginx, "-e", str(self.runner.directory / "nginx-control.log"),
                "-p", self.spec["prefix"], "-c", self.spec["configuration"]]
        self.runner.run(args + ["-t"], timeout=10)
        self.runner.run(args + ["-s", "reload"], timeout=10)

    def assert_closed(self, artifact):
        record = self._record(artifact)
        require(self._read_site()[0] == record["maintenance"], "Maintenance configuration is not installed")
        for scheme, port, path in [("http", self.spec["httpPort"], "/"),
                                  ("https", self.spec["httpsPort"], "/"),
                                  ("https", self.spec["httpsPort"], "/mcp"),
                                  ("https", self.spec["httpsPort"], "/api/countries/test/regenerate"),
                                  ("https", self.spec["httpsPort"], "/socket.io/")]:
            host = self.spec["domain"]
            args = [self.curl, "--disable", "--silent", "--show-error", "--noproxy", "*", "--connect-timeout", "2", "--max-time", "3",
                    "--resolve", "{}:{}:127.0.0.1".format(host, port), "--header", "Connection: close",
                    "--dump-header", "-", "--output", "/dev/null", "--write-out", "%{http_code}"]
            if self.spec["caFile"] is not None:
                args.extend(["--cacert", self.spec["caFile"]])
            response = self.runner.run(args + ["{}://{}:{}{}".format(scheme, host, port, path)], timeout=5, max_bytes=16384)
            marker = ("x-tasktopia-maintenance: " + self.journal.plan_digest).encode()
            require(response.rstrip().endswith(b"503") and marker in response.lower(), "New requests are not in maintenance")

    def enable(self, artifact):
        self._phase("enable_maintenance", {"PREPARING", "RECOVERING"})
        record = self._record(artifact)
        self._replace(record, record["maintenance"])
        # Failure leaves the maintenance file installed. Never silently reopen.
        self._reload()
        deadline = time.monotonic() + 20
        while True:
            try:
                self.assert_closed(artifact)
                return
            except CutoverError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(0.1)

    def open(self, artifact):
        self._phase("open_traffic", {"OPENING"})
        record = self._record(artifact)
        self._replace(record, record["original"])
        self._reload()


def mount_fingerprint(mounts):
    # Docker inspect returns mount arrays in an unspecified order. Preserve
    # every field and duplicate, but compare the set order deterministically.
    return hashlib.sha256(canonical(sorted(mounts, key=canonical))).hexdigest()


class WriterFreeze:
    """Остановка только заранее зафиксированных app/mcp/world контейнеров.

    Переcозданные candidate-контейнеры требуют своего нового inventory. После
    stop host driver дополнительно вызывает DatabaseBackup.assert_quiescent().
    """
    ROLES = {"app": "web", "mcp": "mcp", "world": "world"}

    def __init__(self, journal, lock, runner, docker, maintenance, maintenance_artifact):
        self.journal, self.lock, self.runner, self.docker = journal, lock, runner, docker
        self.maintenance, self.maintenance_artifact = maintenance, maintenance_artifact
        require(os.path.isabs(docker), "Expected an absolute Docker executable")

    def _inventory(self, expected_image):
        self.maintenance._locked()
        require(expected_image in (self.journal.plan["previousImage"], self.journal.plan["candidateImage"]), "Unplanned role image")
        project = self.journal.plan["project"]
        ids = self.runner.run([self.docker, "ps", "-aq", "--no-trunc", "--filter", "label=com.docker.compose.project=" + project]).decode().split()
        require(ids, "Compose project has no containers")
        values = json.loads(self.runner.run([self.docker, "inspect"] + ids))
        result = {}
        for info in values:
            labels = info["Config"]["Labels"]
            require(labels.get("com.docker.compose.project") == project, "Unexpected Compose project")
            role = labels.get("com.docker.compose.service")
            if role not in self.ROLES:
                require(role in ("postgres", "redis") or not info["State"]["Running"], "Unknown project writer")
                continue
            require(role not in result and labels.get("com.docker.compose.oneoff", "false").lower() == "false",
                    "Duplicate or one-off runtime role")
            require(labels.get("com.docker.compose.project.working_dir") == self.journal.plan["appDir"],
                    "Runtime role belongs to another checkout")
            require(info["Image"] == expected_image, "Runtime role image changed")
            require(info["HostConfig"]["RestartPolicy"]["Name"] == "unless-stopped",
                    "Stopped roles must not restart after a daemon reboot")
            environment = dict(item.split("=", 1) for item in info["Config"]["Env"])
            require(environment.get("RUNTIME_ROLE") == self.ROLES[role], "Unexpected runtime role")
            result[role] = {"id": info["Id"], "image": info["Image"],
                            "configSha256": hashlib.sha256(canonical(info["Config"])).hexdigest(),
                            "mountsSha256": mount_fingerprint(info["Mounts"]),
                            "restartPolicy": info["HostConfig"]["RestartPolicy"]["Name"],
                            "running": info["State"]["Running"]}
        require(set(result) == set(self.ROLES), "Missing app/mcp/world role")
        return result

    def capture(self, expected_image):
        return self.runner.publish_json("writers-" + uuid.uuid4().hex + ".json",
            {"planDigest": self.journal.plan_digest, "image": expected_image, "roles": self._inventory(expected_image)})

    def stop(self, artifact):
        self.maintenance._phase("stop_writers", {"PREPARING", "RECOVERING"})
        self.maintenance.assert_closed(self.maintenance_artifact)
        self.runner.verify(artifact)
        with self.runner.open_private(artifact["artifact"]) as stream:
            data = stream.read(65537)
        require(len(data) <= 65536, "Oversized role snapshot")
        record = json.loads(data)
        require(isinstance(record, dict) and set(record) == {"planDigest", "image", "roles"}
                and set(record["roles"]) == set(self.ROLES)
                and record["planDigest"] == self.journal.plan_digest, "Role snapshot belongs to another plan")
        current = self._inventory(record["image"])
        for role in self.ROLES:
            require({k: v for k, v in current[role].items() if k != "running"}
                    == {k: v for k, v in record["roles"][role].items() if k != "running"}, "Role identity or configuration changed")
        self.runner.run([self.docker, "stop", "--time", "30"] + [current[r]["id"] for r in self.ROLES], timeout=45)
        after = self._inventory(record["image"])
        require(all(not v["running"] for v in after.values()), "A runtime role did not stop")
        for role in self.ROLES:
            require(after[role]["id"] == current[role]["id"], "Role changed while stopping")
        self.maintenance.assert_closed(self.maintenance_artifact)
