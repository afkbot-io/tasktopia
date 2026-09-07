from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "deploy"))
from compact_cutover_database import CommandRunner
from compact_cutover_files import FileBackup
from compact_cutover_state import CutoverError


class FileBackupTests(unittest.TestCase):
    def test_restore_and_repeat_preserve_files_and_remove_only_new_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            audit, uploads = root / "audit", root / "uploads"
            audit.mkdir(mode=0o700)
            uploads.mkdir()
            (uploads / "photo").write_bytes(b"original")
            (uploads / "empty").mkdir()
            backend = FileBackup(CommandRunner(audit))
            record = backend.capture("uploads", uploads)
            backend.prove(record)
            (uploads / "photo").write_bytes(b"changed")
            (uploads / "new").mkdir()
            (uploads / "new" / "file").write_bytes(b"new")
            backend.restore(record)
            backend.restore(record)
            self.assertEqual((uploads / "photo").read_bytes(), b"original")
            self.assertFalse((uploads / "new").exists())
            self.assertTrue((uploads / "empty").is_dir())

    def test_unproved_or_corrupt_backup_and_symlinks_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            audit, uploads = root / "audit", root / "uploads"
            audit.mkdir(mode=0o700)
            uploads.mkdir()
            (uploads / "photo").write_bytes(b"original")
            backend = FileBackup(CommandRunner(audit))
            record = backend.capture("uploads", uploads)
            with self.assertRaises(CutoverError):
                backend.restore(record)
            backend.prove(record)
            (audit / "files-uploads" / "photo").write_bytes(b"corrupt")
            with self.assertRaises(CutoverError):
                backend.restore(record)
            self.assertEqual((uploads / "photo").read_bytes(), b"original")
            (uploads / "link").symlink_to(root / "outside")
            with self.assertRaises(CutoverError):
                backend.capture("unsafe", uploads)


if __name__ == "__main__":
    unittest.main()
