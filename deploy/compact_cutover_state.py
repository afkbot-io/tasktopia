"""Durable first-cutover protocol. No Docker/SQL/SSH or production CLI here.

The adapter owns evidence verification, fixed commands and process termination.
An interrupted operation is ambiguous: never resume a forward migration. Recovery
is repeatable while traffic is closed; after any possible opening it is forbidden
to restore the old backup automatically because new user writes may exist.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import uuid


class CutoverError(RuntimeError):
    pass


FORWARD = (
    "inspect", "prepare_candidate_assets", "enable_maintenance", "stop_writers",
    "assert_frozen", "backup", "prove_backup_restore", "migrate_and_regenerate",
    "verify_conservation_and_audit", "activate_candidate_assets",
    "start_candidate_roles", "smoke_candidate",
)
RECOVERY = (
    "enable_maintenance", "stop_writers", "assert_frozen", "verify_backup",
    "restore_database", "restore_files_and_bindings", "verify_restored_baseline",
    "start_previous_roles", "smoke_previous",
)
EARLY_RECOVERY = (
    "enable_maintenance", "stop_writers", "assert_frozen",
    "restore_files_and_bindings", "verify_original_baseline",
    "start_previous_roles", "smoke_previous",
)
KNOWN_OPERATIONS = set(FORWARD + RECOVERY + EARLY_RECOVERY + ("verify_acceptance", "open_traffic"))
STATUSES = {"NEW", "PREPARING", "READY", "RECOVERY_REQUIRED", "RECOVERING",
            "ROLLED_BACK_CLOSED", "OPENING", "ACCEPTED", "ROLLED_BACK"}
MAX_JOURNAL = 1024 * 1024


def require(condition, message):
    if not condition:
        raise CutoverError(message)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def validate_plan(value):
    require(isinstance(value, dict) and set(value) == {
        "version", "runId", "project", "appDir", "revision", "previousImage",
        "candidateImage", "previousStatic", "database", "targetId",
    }, "Unexpected cutover plan fields")
    require(value["version"] == 1 and type(value["version"]) is int, "Unsupported plan version")
    for name, pattern in {
        "runId": r"[a-z0-9][a-z0-9-]{7,63}", "project": r"[a-z][a-z0-9_-]{0,39}",
        "revision": r"[a-f0-9]{40}", "previousImage": r"sha256:[a-f0-9]{64}",
        "candidateImage": r"sha256:[a-f0-9]{64}", "database": r"tasktopia",
        "targetId": r"[a-f0-9]{64}",
    }.items():
        require(isinstance(value[name], str) and re.fullmatch(pattern, value[name]), "Invalid plan " + name)
    require(value["previousImage"] != value["candidateImage"], "Cutover requires distinct images")
    for name in ("appDir", "previousStatic"):
        path = value[name]
        require(isinstance(path, str) and re.fullmatch(r"/[A-Za-z0-9._/-]+", path), "Invalid plan path")
        require(len(Path(path).parts) >= 4 and ".." not in Path(path).parts
                and "//" not in path and not path.endswith("/"), "Unbounded plan path")
    return json.loads(canonical(value))


def validate_evidence(value):
    require(isinstance(value, dict) and set(value) == {"artifact", "sha256"}, "Missing step evidence")
    artifact = value["artifact"]
    require(isinstance(artifact, str) and re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,127}", artifact),
            "Evidence must name one local artifact, not a command or external path")
    require(isinstance(value["sha256"], str) and re.fullmatch(r"[a-f0-9]{64}", value["sha256"]),
            "Evidence needs SHA256")


class Journal:
    """An exclusive private, fsync'd local journal bound to one exact plan.

    This lock protects the journal only. The host adapter must additionally
    hold the same deployment lock as the normal updater for its entire run.
    """
    def __init__(self, directory, plan):
        self.directory = Path(directory)
        self.plan = validate_plan(plan)
        self.plan_digest = hashlib.sha256(canonical(self.plan)).hexdigest()
        self.fd = None
        self.state = None

    def __enter__(self):
        try:
            self.directory.mkdir(mode=0o700, parents=False, exist_ok=True)
            require(not self.directory.is_symlink(), "Symlink journal directory")
            info = self.directory.stat()
            require(info.st_uid == os.getuid() and info.st_mode & 0o077 == 0, "Journal must be private and owned")
            # Persist the directory entry itself before any external operation;
            # fsync(state.json) alone cannot preserve a newly created parent.
            parent_fd = os.open(self.directory.parent, os.O_RDONLY)
            try:
                os.fsync(parent_fd)
            finally:
                os.close(parent_fd)
            self.fd = os.open(self.directory / "lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
            try:
                fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise CutoverError("Another operator owns this journal") from None
            path = self.directory / "state.json"
            if path.exists() or path.is_symlink():
                fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
                with os.fdopen(fd, "rb") as stream:
                    info = os.fstat(stream.fileno())
                    require(info.st_uid == os.getuid() and info.st_mode & 0o077 == 0, "Journal state must be private")
                    encoded = stream.read(MAX_JOURNAL + 1)
                require(len(encoded) <= MAX_JOURNAL, "Oversized journal")
                self.state = json.loads(encoded)
                require(isinstance(self.state, dict) and set(self.state) in (
                    {"version", "planDigest", "plan", "status", "pending", "evidence"},
                    {"version", "planDigest", "plan", "status", "pending", "evidence", "restoreRequired"},
                ), "Invalid journal fields")
                require("restoreRequired" not in self.state or type(self.state["restoreRequired"]) is bool,
                        "Invalid recovery decision")
                require(self.state.get("version") == 1 and self.state.get("planDigest") == self.plan_digest
                        and self.state.get("plan") == self.plan, "Journal belongs to another plan")
                require(self.state.get("status") in STATUSES, "Unknown journal status")
                require(self.state.get("pending") is None or self.state["pending"] in KNOWN_OPERATIONS, "Unknown pending step")
                require(isinstance(self.state.get("evidence"), dict), "Invalid journal evidence")
                for name, evidence in self.state["evidence"].items():
                    require(name in KNOWN_OPERATIONS, "Unknown evidence step")
                    validate_evidence(evidence)
            else:
                self.state = {"version": 1, "planDigest": self.plan_digest, "plan": self.plan,
                              "status": "NEW", "pending": None, "evidence": {}}
                self.save()
            return self
        except BaseException:
            self.__exit__(None, None, None)
            raise

    def __exit__(self, *_):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None

    def save(self):
        require(self.fd is not None, "Journal is not locked")
        encoded = canonical(self.state) + b"\n"
        require(len(encoded) <= MAX_JOURNAL, "Oversized journal")
        temporary = self.directory / (".state-" + uuid.uuid4().hex)
        fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(encoded)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.directory / "state.json")
            directory_fd = os.open(self.directory, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        finally:
            if temporary.exists():
                temporary.unlink()


def step(journal, driver, operation):
    # Journal before invoking the adapter. A killed process leaves the operation
    # ambiguous, even if it completed its external command before the crash.
    journal.state["pending"] = operation
    journal.save()
    try:
        evidence = driver.run(operation, json.loads(canonical(journal.plan)),
                              json.loads(canonical(journal.state["evidence"])))
        validate_evidence(evidence)
    except Exception:
        journal.state["status"] = "RECOVERY_REQUIRED"
        journal.save()
        # Never serialize raw subprocess/SQL errors, which can contain secrets.
        raise CutoverError("Cutover stopped at " + operation + "; traffic must remain closed") from None
    journal.state["evidence"][operation] = evidence
    journal.state["pending"] = None
    journal.save()


def prepare(journal, driver):
    require(journal.state["status"] == "NEW" and journal.state["pending"] is None,
            "Forward resume is forbidden; inspect and recover this run")
    require(not journal.state["evidence"] and "restoreRequired" not in journal.state, "New journal is not empty")
    journal.state["status"] = "PREPARING"
    journal.save()
    for operation in FORWARD:
        step(journal, driver, operation)
    journal.state["status"] = "READY"
    journal.save()


def recover(journal, driver):
    require(journal.state["status"] in {"PREPARING", "READY", "RECOVERY_REQUIRED", "RECOVERING"},
            "Recovery is not allowed in this state")
    require(journal.state["pending"] != "open_traffic" and "open_traffic" not in journal.state["evidence"],
            "Traffic may have admitted new writes; old-backup restore is forbidden")
    # Once a destructive step may have started, recovery always restores from
    # a proven backup. Persist this decision: a second interrupted recovery may
    # otherwise forget the original pending migration after overwriting it.
    journal.state["restoreRequired"] = (
        journal.state.get("restoreRequired", False)
        or journal.state["pending"] == "migrate_and_regenerate"
        or "migrate_and_regenerate" in journal.state["evidence"])
    if journal.state["restoreRequired"]:
        require("backup" in journal.state["evidence"] and "prove_backup_restore" in journal.state["evidence"],
                "Destructive recovery requires a proven backup")
    journal.state["status"] = "RECOVERING"
    journal.save()
    for operation in RECOVERY if journal.state["restoreRequired"] else EARLY_RECOVERY:
        step(journal, driver, operation)
    journal.state["status"] = "ROLLED_BACK_CLOSED"
    journal.save()


def accept(journal, driver, confirmed_plan_digest):
    require(confirmed_plan_digest == journal.plan_digest, "Acceptance belongs to another plan")
    require(journal.state["status"] in {"READY", "ROLLED_BACK_CLOSED"}
            and journal.state["pending"] is None, "Run is not ready for explicit acceptance")
    rolled_back = journal.state["status"] == "ROLLED_BACK_CLOSED"
    required = (RECOVERY if journal.state.get("restoreRequired") else EARLY_RECOVERY) if rolled_back else FORWARD
    require(all(operation in journal.state["evidence"] for operation in required), "Incomplete acceptance evidence")
    step(journal, driver, "verify_acceptance")
    # Persist the no-return boundary BEFORE attempting to open traffic.
    journal.state["status"] = "OPENING"
    journal.save()
    step(journal, driver, "open_traffic")
    journal.state["status"] = "ROLLED_BACK" if rolled_back else "ACCEPTED"
    journal.save()
