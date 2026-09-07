"""Реальные nginx/TLS и Docker freeze на новых локальных ресурсах; не production."""
import argparse
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
from compact_cutover_database import CommandRunner
from compact_cutover_host import DeploymentLock, NginxMaintenance, WriterFreeze
from compact_cutover_state import CutoverError, Journal, require


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True)
    parser.add_argument("--nginx", default=shutil.which("nginx"))
    parser.add_argument("--openssl", default=shutil.which("openssl"))
    args = parser.parse_args()
    docker, curl = shutil.which("docker"), shutil.which("curl")
    require(all((docker, curl, args.nginx, args.openssl)), "nginx, OpenSSL, Docker and curl are required")
    root = Path(__file__).resolve().parents[1]
    (root / "tmp").mkdir(mode=0o700, exist_ok=True)
    directory = Path(tempfile.mkdtemp(prefix="cutover-host-", dir=str(root / "tmp"))).resolve()
    audit = directory / "audit"
    audit.mkdir(mode=0o700)
    runner = CommandRunner(audit)
    token = uuid.uuid4().hex
    project = "cutover-test-" + token[:12]
    app, prefix, certs = directory / "app", directory / "nginx", directory / "certs"
    (app / ".git").mkdir(parents=True)
    (prefix / "sites-enabled").mkdir(parents=True)
    (prefix / "sites-available").mkdir()
    live = certs / "live" / "cutover.test"
    live.mkdir(parents=True)
    runner.run([args.openssl, "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                "-keyout", str(live / "privkey.pem"), "-out", str(live / "fullchain.pem"), "-subj", "/CN=cutover.test",
                "-addext", "subjectAltName=DNS:cutover.test"])
    (live / "privkey.pem").chmod(0o600)
    runner.run([args.openssl, "genpkey", "-genparam", "-algorithm", "DH", "-pkeyopt", "group:ffdhe2048",
                "-out", str(certs / "ssl-dhparams.pem")])
    (certs / "options-ssl-nginx.conf").write_text("# Isolated test certificate\n")
    sockets = []
    for _ in range(2):
        connection = socket.socket()
        connection.bind(("127.0.0.1", 0))
        sockets.append(connection)
    ports = [s.getsockname()[1] for s in sockets]
    site = prefix / "sites-available" / "tasktopia"
    enabled = prefix / "sites-enabled" / "tasktopia"
    enabled.symlink_to(site)
    configuration = prefix / "nginx.conf"
    config = ("pid " + str(prefix / "nginx.pid") + ";\nerror_log " + str(prefix / "error.log") + ";\n"
              "events {}\nhttp { access_log off; client_body_temp_path " + str(prefix / "client") + "; "
              "proxy_temp_path " + str(prefix / "proxy") + "; include " + str(enabled) + "; }\n")
    configuration.write_text(config)
    spec = {"site": str(site), "enabled": str(enabled), "prefix": str(prefix), "configuration": str(configuration),
            "certRoot": str(certs), "staticRoot": str(directory / "static"), "domain": "cutover.test",
            "httpPort": ports[0], "httpsPort": ports[1], "caFile": str(live / "fullchain.pem"), "loopbackOnly": True}
    plan = {"version": 1, "runId": project, "project": project, "appDir": str(app), "revision": "a" * 40,
            "previousImage": args.image, "candidateImage": "sha256:" + "b" * 64,
            "previousStatic": str(directory / "static" / "previous"), "database": "tasktopia", "targetId": "c" * 64}
    process, containers = None, []
    report = {"production": False, "status": "running", "directory": str(directory), "image": args.image}

    def command(values, **options):
        return runner.run([docker] + values, **options)

    def create_role(role, runtime):
        name = project + "-" + role
        require(not command(["ps", "-aq", "--filter", "name=^/" + name + "$"]).strip(), "Fixture name exists")
        containers.append(name)
        runner.publish_json(role + "-intent.json", {"name": name, "image": args.image, "token": token})
        ident = command(["create", "--name", name, "--label", "tasktopia.host-test=" + token,
            "--label", "com.docker.compose.project=" + project, "--label", "com.docker.compose.service=" + role,
            "--label", "com.docker.compose.project.working_dir=" + str(app),
            "--label", "com.docker.compose.oneoff=False", "--restart", "unless-stopped", "--network", "none", "--no-healthcheck", "--log-driver", "none",
            "--memory", "64m", "--cpus", "0.25", "--pids-limit", "32", "--env", "RUNTIME_ROLE=" + runtime,
            "--entrypoint", "sleep", args.image, "900"]).decode().strip()
        info = owned(name)
        require(info["Id"] == ident, "Fixture identity changed")
        command(["start", ident])
        return ident

    def owned(name):
        info = json.loads(command(["inspect", name]))[0]
        require(info["Name"] == "/" + name and info["Image"] == args.image
                and info["Config"]["Labels"].get("tasktopia.host-test") == token
                and info["HostConfig"]["NetworkMode"] == "none", "Not our isolated role container")
        return info

    try:
        with DeploymentLock(app) as lock, Journal(directory / "journal", plan) as journal:
            maintenance = NginxMaintenance(journal, lock, runner, spec, args.nginx, curl)
            original = next(maintenance._canonical_sites())
            site.write_text(original)
            site.chmod(0o600)
            site.write_text(original + "# custom deployment\n")
            try:
                maintenance.capture()
                raise AssertionError("Customized site was accepted")
            except CutoverError:
                require(not (audit / "nginx-baseline.json").exists(), "Rejected site created a baseline")
                report["customizedSiteRejected"] = True
            site.write_text(original)
            artifact = maintenance.capture()
            for s in sockets:
                s.close()
            process = subprocess.Popen([args.nginx, "-e", str(audit / "nginx-startup.log"), "-p", str(prefix),
                                       "-c", str(configuration), "-g", "daemon off;"],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
            for _ in range(50):
                require(process.poll() is None, "Isolated nginx exited")
                if (prefix / "nginx.pid").exists():
                    break
                time.sleep(0.1)
            require((prefix / "nginx.pid").exists(), "nginx never started")
            for role, runtime in WriterFreeze.ROLES.items():
                create_role(role, runtime)
            freeze = WriterFreeze(journal, lock, runner, docker, maintenance, artifact)
            roles = freeze.capture(args.image)

            def phase(status, operation):
                journal.state.update(status=status, pending=operation)
                journal.save()

            phase("PREPARING", "enable_maintenance")
            configuration.write_text(config + "invalid_cutover_test_directive;\n")
            try:
                maintenance.enable(artifact)
                raise AssertionError("Invalid nginx configuration was accepted")
            except CutoverError:
                require("return 503;" in site.read_text(), "Failure silently restored open configuration")
                report["reloadFailureKeepsMaintenanceFile"] = True
            configuration.write_text(config)
            phase("RECOVERING", "enable_maintenance")
            maintenance.enable(artifact)
            report["httpHttpsMcpApiWebsocket503"] = True
            try:
                maintenance.open(artifact)
                raise AssertionError("Opening without accept was allowed")
            except CutoverError:
                report["unacceptedOpeningRejected"] = True
            unknown = create_role("unknown-writer", "unknown")
            phase("RECOVERING", "stop_writers")
            try:
                freeze.stop(roles)
                raise AssertionError("Unknown writer was accepted")
            except CutoverError:
                require(all(owned(project + "-" + r)["State"]["Running"] for r in WriterFreeze.ROLES), "Unverified stop changed a role")
                report["unknownWriterRejectedWithoutStoppingRoles"] = True
            command(["stop", "--time", "5", unknown])
            app_id = owned(project + "-app")["Id"]
            command(["update", "--restart", "always", app_id])
            try:
                freeze.stop(roles)
                raise AssertionError("A role that can restart after reboot was accepted")
            except CutoverError:
                require(owned(project + "-app")["State"]["Running"], "Unverified stop changed a role")
                report["unsafeRestartPolicyRejected"] = True
            command(["update", "--restart", "unless-stopped", app_id])
            freeze.stop(roles)
            freeze.stop(roles)
            report["threeRolesStoppedAndRepeatable"] = True
            phase("OPENING", "open_traffic")
            maintenance.open(artifact)
            require(site.read_text() == original, "Original site was not restored byte-for-byte")
            report["explicitOpeningRestoresOriginal"] = True
            report["status"] = "passed"
    finally:
        for s in sockets:
            s.close()
        if process is not None and process.poll() is None:
            process.terminate()
            process.wait(timeout=15)
        for port in ports:
            with socket.socket() as probe:
                probe.settimeout(1)
                require(probe.connect_ex(("127.0.0.1", port)) != 0, "A fixture listener remained open")
        for name in reversed(containers):
            if command(["ps", "-aq", "--filter", "name=^/" + name + "$"]).strip():
                info = owned(name)
                if info["State"]["Running"]:
                    command(["stop", "--time", "5", info["Id"]])
                require(not owned(name)["State"]["Running"], "Role fixture failed to stop")
        if report["status"] != "passed":
            report["status"] = "failed"
        report["resourcesPreserved"] = True
        result = runner.publish_json("host-integration-report.json", report)
        print(json.dumps({"status": report["status"], "directory": str(directory), "reportSha256": result["sha256"], "production": False}), flush=True)


if __name__ == "__main__":
    main()
