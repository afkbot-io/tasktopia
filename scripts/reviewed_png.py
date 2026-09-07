"""Keep reviewed PNG bytes only after exact source, file and RGBA verification."""
import hashlib
from io import BytesIO
from pathlib import Path

from PIL import Image


def save_reviewed_png(candidate: Image.Image, path: Path, source_sha256: str,
                      approval: dict | None = None) -> str:
    """Drafts encode normally; approved artifacts are immutable canonical files.

    PNG encoders/zlib builds can emit different bytes for identical pixels.
    Never substitute a new encoding or silently repair a missing/tampered
    canonical file. The caller still owns semantic approval and raster gates.
    """
    if approval is None:
        candidate.save(path)
        return hashlib.sha256(path.read_bytes()).hexdigest()
    if approval.get("sourceSha256") != source_sha256:
        raise ValueError("source review missing or stale")
    try:
        canonical_bytes = path.read_bytes()
    except OSError as error:
        raise ValueError("reviewed canonical PNG is missing or unreadable") from error
    canonical_sha256 = hashlib.sha256(canonical_bytes).hexdigest()
    if canonical_sha256 != approval.get("runtimeSha256"):
        raise ValueError("reviewed canonical PNG byte SHA is stale or corrupt")
    try:
        with Image.open(BytesIO(canonical_bytes)) as image:
            canonical = image.convert("RGBA")
    except (OSError, ValueError) as error:
        raise ValueError("reviewed canonical PNG cannot be decoded") from error
    if canonical.size != candidate.size or canonical.tobytes() != candidate.convert("RGBA").tobytes():
        raise ValueError("fresh normalized pixels or dimensions differ from reviewed canonical PNG")
    # Do not save even an identical image: that would replace the approved
    # encoder bytes. Every visible and invisible RGBA byte was checked above.
    return canonical_sha256
