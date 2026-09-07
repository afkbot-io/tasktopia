"""Один полный prepare/recover/accept на новой копии БД и отдельных runtime/NGINX.

Host binding CLI проверяется отдельно на установленной цели. Здесь binding
указывает только новые локальные ресурсы; production endpoint отсутствует.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "deploy"))
from compact_cutover_database import CommandRunner, DatabaseBackup
from compact_cutover_driver import HostDriver
from compact_cutover_host import DeploymentLock, NginxMaintenance
from compact_cutover_state import Journal, accept, canonical, prepare, recover, require


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True)
    parser.add_argument("--previous-image", required=True)
    parser.add_argument("--pg-image", required=True)
    parser.add_argument("--archive", required=True)
    parser.add_argument("--archive-sha256", required=True)
    parser.add_argument("--nginx", default=shutil.which("nginx"))
    parser.add_argument("--openssl", default=shutil.which("openssl"))
    args = parser.parse_args()
    require(args.image != args.previous_image, "Need distinct pinned images")
    root = Path(__file__).resolve().parents[1]
    directory = Path(tempfile.mkdtemp(prefix="cutover-driver-", dir=str(root / "tmp"))).resolve()
    audit = directory / "audit"
    audit.mkdir(mode=0o700)
    runner = CommandRunner(audit)
    docker = shutil.which("docker")
    token = "compact-test-" + uuid.uuid4().hex[:12]
    network = token + "-net"
    owned = []
    def cmd(values, **kw):
        return runner.run([docker] + values, **kw)
    def create(name, image, extra, entry):
        owned.append((name, image))
        return cmd(["create", "--name", name, "--label", "tasktopia.driver-test=" + token,
                    "--network", network] + extra + [image] + entry).decode().strip()
    # Docker Desktop internal networks do not publish loopback ports to macOS.
    # Only test roles expose loopback health ports; PostgreSQL remains unpublished.
    cmd(["network", "create", "--label", "tasktopia.driver-test=" + token, network])
    process = None
    ports = []
    for _ in range(5):
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            ports.append(sock.getsockname()[1])
    app = directory / "app"
    (app / ".git").mkdir(parents=True)
    (app / "deploy").mkdir()
    shutil.copy2(root / "deploy/static-release.sh", app / "deploy/static-release.sh")
    (app / ".env").write_text("# isolated fixture\n")
    (app / ".env").chmod(0o600)
    static = directory / "static"
    previous_static = static / "releases" / "previous"
    previous_static.mkdir(parents=True)
    (previous_static / "keep.txt").write_text("old release")
    (static / "current").symlink_to(previous_static)
    prefix = directory / "nginx"
    prefix.mkdir()
    certs = directory / "certs"
    live = certs / "live" / "cutover.test"
    live.mkdir(parents=True)
    runner.run([args.openssl, "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
        "-keyout", str(live / "privkey.pem"), "-out", str(live / "fullchain.pem"),
        "-subj", "/CN=cutover.test", "-addext", "subjectAltName=DNS:cutover.test"])
    runner.run([args.openssl, "genpkey", "-genparam", "-algorithm", "DH", "-pkeyopt", "group:ffdhe2048",
                "-out", str(certs / "ssl-dhparams.pem")])
    (certs / "options-ssl-nginx.conf").write_text("# isolated TLS\n")
    site = prefix / "site.conf"
    enabled = prefix / "enabled.conf"
    enabled.symlink_to(site)
    configuration = prefix / "nginx.conf"
    configuration.write_text("pid " + str(prefix / "nginx.pid") + ";\nerror_log " + str(prefix / "error.log")
        + ";\nevents {}\nhttp { access_log off; client_body_temp_path " + str(prefix / "client")
        + "; proxy_temp_path " + str(prefix / "proxy") + "; include " + str(enabled) + "; }\n")
    spec = {"site": str(site), "enabled": str(enabled), "prefix": str(prefix), "configuration": str(configuration),
        "certRoot": str(certs), "staticRoot": str(static), "domain": "cutover.test", "httpPort": ports[0],
        "httpsPort": ports[1], "caFile": str(live / "fullchain.pem"), "loopbackOnly": True}
    report = {"production": False, "status": "running", "directory": str(directory)}
    try:
        pg_name = token + "-postgres"
        pg = create(pg_name, args.pg_image, ["--network-alias", "postgres", "--memory", "1g", "--cpus", "2",
            "-e", "POSTGRES_USER=tasktopia", "-e", "POSTGRES_DB=tasktopia", "-e", "POSTGRES_HOST_AUTH_METHOD=trust"], [])
        cmd(["start", pg])
        info = json.loads(cmd(["inspect", pg]))[0]
        db = DatabaseBackup(runner, {"id": pg, "image": args.pg_image, "volume": info["Mounts"][0]["Name"]}, docker)
        for attempt in range(60):
            try:
                cmd(["exec", pg, "pg_isready", "-h", "127.0.0.1", "-U", "tasktopia"], timeout=5)
                break
            except Exception:
                require(attempt < 59, "PG not ready")
                time.sleep(0.25)
        archive = Path(args.archive)
        require(archive.is_file() and not archive.is_symlink() and archive.stat().st_mode & 0o077 == 0, "Private archive required")
        require(hashlib.sha256(archive.read_bytes()).hexdigest() == args.archive_sha256, "Archive mismatch")
        shutil.copyfile(archive, audit / "seed.dump")
        (audit / "seed.dump").chmod(0o600)
        db.pg(["pg_restore", "--exit-on-error", "-U", "tasktopia", "-d", "tasktopia"], input_name="seed.dump", seconds=900)
        # Previous fixture roles only serve health. They cannot read/write the seeded DB.
        old = {"name": token, "services": {}, "networks": {"default": {"name": network, "external": True}}}
        new = json.loads(canonical(old))
        for i, role in enumerate(("app", "mcp", "world")):
            runtime = "web" if role == "app" else role
            base = {"image": args.previous_image, "restart": "unless-stopped",
                "labels": {"tasktopia.driver-test": token}, "environment": {"RUNTIME_ROLE": runtime},
                "ports": ["127.0.0.1:" + str(ports[i + 2]) + ":3000"],
                "healthcheck": {"test": ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)})"],
                                "interval": "1s", "timeout": "3s", "retries": 5}}
            old["services"][role] = dict(base, entrypoint=["node", "-e"], command=["require('http').createServer((q,s)=>s.end('ok')).listen(3000,'0.0.0.0')"])
            new["services"][role] = dict(base, image=args.image, environment={
                "NODE_ENV": "production", "HOST": "0.0.0.0", "PORT": "3000", "RUNTIME_ROLE": runtime,
                "DATABASE_URL": "postgres://tasktopia@postgres:5432/tasktopia", "REDIS_URL": "",
                "APP_ORIGIN": "http://localhost:" + str(ports[2]), "REGISTRATION_ENABLED": "false"})
        prev_record = runner.publish_json("previous-compose.json", old)
        next_record = runner.publish_json("candidate-compose.json", new)
        binding = {"appDir": str(app), "daemon": cmd(["info", "--format", "{{.ID}}"]).decode().strip(),
            "envSha256": hashlib.sha256((app / ".env").read_bytes()).hexdigest(), "network": network,
            "database": db.target, "volumes": {}, "previousCompose": prev_record, "candidateCompose": next_record,
            "staticRoot": str(static), "candidateStatic": str(static / "releases" / token), "healthPorts": ports[2:], "nginx": spec}
        plan = {"version": 1, "runId": token, "project": token, "appDir": str(app), "revision": "a" * 40,
            "previousImage": args.previous_image, "candidateImage": args.image, "previousStatic": str(previous_static),
            "database": "tasktopia", "targetId": hashlib.sha256(canonical(binding)).hexdigest()}
        with DeploymentLock(app) as lock, Journal(directory / "journal", plan) as journal:
            driver = HostDriver(journal, lock, runner, binding)
            driver.maintenance.nginx = args.nginx
            site.write_text(list(driver.maintenance._canonical_sites())[2])  # official CDN layout
            site.chmod(0o600)
            process = subprocess.Popen([args.nginx, "-e", str(audit / "nginx-startup.log"), "-p", str(prefix),
                "-c", str(configuration), "-g", "daemon off;"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            for _ in range(50):
                require(process.poll() is None, "Nginx exited")
                if (prefix / "nginx.pid").exists():
                    break
                time.sleep(0.1)
            driver.start_roles(previous=True)
            driver.health(previous=True)
            prepare(journal, driver)
            require(journal.state["status"] == "READY", "Prepare incomplete")
            report["prepare"] = "passed with real candidate roles, migrations, FORCE, conservation and audit"
            # A closed prepared candidate may be rolled back jointly, then opened.
            recover(journal, driver)
            require(journal.state["status"] == "ROLLED_BACK_CLOSED", "Recovery incomplete")
            report["recovery"] = "exact full DB snapshot and previous static, previous roles healthy"
            accept(journal, driver, journal.plan_digest)
            require(journal.state["status"] == "ROLLED_BACK", "Rollback acceptance incomplete")
            report["accept"] = "passed"
            report["status"] = "passed"
    finally:
        if report["status"] != "passed":
            report["status"] = "failed"
        if process is not None and process.poll() is None:
            process.terminate()
            process.wait(timeout=15)
        for label in ("tasktopia.driver-test=" + token, "tasktopia.cutover-run=" + token):
            ids = cmd(["ps", "-q", "--no-trunc", "--filter", "label=" + label]).decode().split()
            for ident in ids:
                info = json.loads(cmd(["inspect", ident]))[0]
                require(info["Image"] in (args.image, args.previous_image, args.pg_image), "Unknown fixture image")
                cmd(["stop", "--time", "10", ident], timeout=20)
        report["resourcesPreserved"] = True
        record = runner.publish_json("driver-report.json", report)
        print(json.dumps({"status": report["status"], "directory": str(directory), "sha256": record["sha256"]}), flush=True)


if __name__ == "__main__":
    main()
