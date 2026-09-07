"""Private snapshot uploads/assets; restore only inside the frozen host driver."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import uuid

from compact_cutover_database import fsync_directory, local_name
from compact_cutover_state import canonical, require


def file_hash(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def inventory(root):
    root = Path(root)
    require(root.is_absolute() and root.resolve() == root and len(root.parts) >= 4,
            "File snapshot needs an exact bounded real directory")
    require(root.is_dir(), "Missing snapshot directory")
    result = {}
    for path in [root] + sorted(root.rglob("*")):
        info = path.lstat()
        require(stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode),
                "Symlinks and special files are not supported in this cutover")
        require(info.st_dev == root.stat().st_dev, "Nested mounts require separate recovery")
        relative = str(path.relative_to(root))
        require("\n" not in relative and len(result) < 100000, "Invalid or oversized file inventory")
        item = {"mode": stat.S_IMODE(info.st_mode), "uid": info.st_uid, "gid": info.st_gid,
                "kind": "dir" if path.is_dir() else "file"}
        if item["kind"] == "file":
            require(info.st_nlink == 1, "Hardlinks require separate recovery")
            item.update(size=info.st_size, sha256=file_hash(path))
        result[relative] = item
    return result


def copy_contents(source, destination, expected):
    """Bounded roots already validated. New backup/proof or explicit recovery."""
    destination.mkdir(exist_ok=True)
    for relative, entry in sorted(expected.items(), key=lambda kv: (len(Path(kv[0]).parts), kv[0])):
        target = destination / relative
        if entry["kind"] == "dir":
            target.mkdir(exist_ok=True)
        else:
            temporary = target.parent / (".cutover-" + uuid.uuid4().hex)
            try:
                with (source / relative).open("rb") as src, temporary.open("xb") as dst:
                    shutil.copyfileobj(src, dst, 1024 * 1024)
                    dst.flush()
                    os.fsync(dst.fileno())
                os.replace(temporary, target)
                fsync_directory(target.parent)
            finally:
                if temporary.exists():
                    temporary.unlink()
        if target.stat().st_uid != entry["uid"] or target.stat().st_gid != entry["gid"]:
            os.chown(target, entry["uid"], entry["gid"])
        os.chmod(target, entry["mode"])
    for path in sorted([destination] + list(destination.rglob("*")), reverse=True):
        if path.is_dir():
            fsync_directory(path)
        else:
            with path.open("rb") as stream:
                os.fsync(stream.fileno())


class FileBackup:
    def __init__(self, runner):
        self.runner = runner

    def capture(self, name, source):
        local_name(name)
        source = Path(source)
        before = inventory(source)
        require(shutil.disk_usage(self.runner.directory).free >
                sum(item.get("size", 0) for item in before.values()) * 2 + 1024 ** 3,
                "Insufficient file backup space")
        target = self.runner.directory / ("files-" + name)
        require(not target.exists(), "File backup already exists")
        copy_contents(source, target, before)
        require(inventory(source) == before and inventory(target) == before,
                "Files changed while taking backup")
        return self.runner.publish_json("files-" + name + ".json",
            {"source": str(source), "copy": target.name, "files": before})

    def read(self, record):
        self.runner.verify(record)
        with self.runner.open_private(record["artifact"]) as stream:
            value = json.load(stream)
        require(set(value) == {"source", "copy", "files"}, "Invalid file backup")
        local_name(value["copy"])
        require(inventory(self.runner.directory / value["copy"]) == value["files"],
                "File backup is corrupt")
        return value

    def prove(self, record):
        value = self.read(record)
        proof = self.runner.directory / ("proof-" + value["copy"])
        require(not proof.exists(), "File proof already exists")
        copy_contents(self.runner.directory / value["copy"], proof, value["files"])
        require(inventory(proof) == value["files"], "File restore proof mismatch")
        return self.runner.publish_json("proof-" + record["artifact"],
            {"backup": record, "snapshotSha256": hashlib.sha256(canonical(value["files"])).hexdigest()})

    def restore(self, record):
        value = self.read(record)
        proof_path = self.runner.directory / ("proof-" + record["artifact"])
        require(proof_path.exists(), "No independent file restore proof")
        with self.runner.open_private(proof_path.name) as stream:
            proof = json.load(stream)
        require(proof == {"backup": record,
                "snapshotSha256": hashlib.sha256(canonical(value["files"])).hexdigest()}, "Wrong file restore proof")
        destination = Path(value["source"])
        current = inventory(destination)  # refuse symlinks/mounts before touching anything
        for relative in sorted(current, key=lambda p: (len(Path(p).parts), p), reverse=True):
            if relative == ".":
                continue
            if relative not in value["files"] or current[relative]["kind"] != value["files"][relative]["kind"]:
                path = destination / relative
                if current[relative]["kind"] == "dir":
                    path.rmdir()
                else:
                    path.unlink()
        copy_contents(self.runner.directory / value["copy"], destination, value["files"])
        require(inventory(destination) == value["files"], "File recovery mismatch")
