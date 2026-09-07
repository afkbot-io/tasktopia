"""Native support gate and unchanged publisher for reviewed courtyard props."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

from PIL import Image

PROFILE = "TASKTOPIA_COMPACT_COURTYARD_HIGH_45_V1"
GEOMETRY = {
    "courtyard-picnic-table": ([16, 16], [2, 2], [8, 16]),
    "courtyard-square-planter": ([8, 8], [1, 1], [4, 8]),
    "courtyard-cycle-rack": ([16, 8], [2, 1], [8, 8]),
}


def components(points, diagonal=False):
    remaining = set(points)
    groups = []
    offsets = [(dx, dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1)
               if (dx or dy) and (diagonal or abs(dx) + abs(dy) == 1)]
    while remaining:
        group = {remaining.pop()}
        stack = list(group)
        while stack:
            x, y = stack.pop()
            for dx, dy in offsets:
                neighbor = (x + dx, y + dy)
                if neighbor in remaining:
                    remaining.remove(neighbor)
                    group.add(neighbor)
                    stack.append(neighbor)
        groups.append(group)
    return groups


def rack_supports_valid(image):
    """Three rectangular openings, connected tops/six legs and a shared base.

    Background uses8-connectivity so a diagonally attached cap cannot falsely
    enclose its opening. This checks pixel structure, not art style/camera.
    """
    image = image.convert("RGBA")
    width, height = image.size
    if (width, height) != (16, 8):
        return False
    opaque = {(x, y) for y in range(height) for x in range(width)
              if image.getpixel((x, y))[3] == 255}
    if len(components(opaque)) != 1:
        return False
    empty = {(x, y) for y in range(height) for x in range(width)} - opaque
    holes = [group for group in components(empty, diagonal=True)
             if all(0 < x < width - 1 and 0 < y < height - 1 for x, y in group)]
    if len(holes) != 3:
        return False
    for hole in holes:
        left, right = min(x for x, _ in hole), max(x for x, _ in hole)
        top, bottom = min(y for _, y in hole), max(y for _, y in hole)
        if bottom - top + 1 < 2 or len(hole) != (right - left + 1) * (bottom - top + 1):
            return False
        boundary = {(x, y) for y in range(top - 1, bottom + 2) for x in range(left - 1, right + 2)
                    if x in (left - 1, right + 1) or y in (top - 1, bottom + 1)}
        if not boundary <= opaque:
            return False
    return True


def publish_courtyard_furniture(root: Path, manifest: dict) -> None:
    pack = root / "assets/pixel-city-pack"
    family = pack / "reference/ai-authored/compact-courtyard-furniture-v1"
    subprocess.run([sys.executable, str(family / "normalize-verify.py"),
                    "--require-complete", "--require-review"], check=True, stdout=subprocess.DEVNULL)
    geometry = json.loads((family / "geometry.json").read_text())
    report = json.loads((family / "report.json").read_text())
    if geometry["visualProfile"] != PROFILE or set(geometry["objects"]) != set(GEOMETRY) or report["errors"]:
        raise ValueError("Invalid courtyard furniture family")
    catalog_path = pack / "catalog/ai-authored-props.json"
    catalog = [entry for entry in json.loads(catalog_path.read_text()) if entry["key"] not in GEOMETRY]
    for key, (size, footprint, anchor) in GEOMETRY.items():
        entry = geometry["objects"][key]
        if any(entry[field] != expected for field, expected in
               (("spriteSize", size), ("footprintCells", footprint), ("anchorPx", anchor))):
            raise ValueError(f"Courtyard geometry drift: {key}")
        measured = report["objects"][key]
        source = family / "normalized" / f"{key}.png"
        if hashlib.sha256(source.read_bytes()).hexdigest() != measured["runtimeSha256"]:
            raise ValueError(f"Stale courtyard normalization: {key}")
        with Image.open(source) as image:
            if list(image.size) != size or key == "courtyard-cycle-rack" and not rack_supports_valid(image):
                raise ValueError(f"Invalid courtyard native image: {key}")
        path = f"props/{key}.png"
        sheet = f"ai-authored/compact-courtyard-furniture-v1/sources/{key}.png"
        for base in (pack / "runtime", root / "public/game-assets/v5"):
            target = base / path
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
        manifest["props"][key] = {
            "label": entry["label"], "path": path, "size": size, "footprintCells": footprint,
            "anchorPx": anchor, "artSource": "AI_AUTHORED", "sourceSheet": sheet, "visualProfile": PROFILE,
        }
        catalog.append({"key": key, "label": entry["label"], "sheet": sheet, "size": size,
                        "footprintCells": footprint, "anchorPx": anchor, "reviewed": True,
                        "visualProfile": PROFILE, "sourceSha256": measured["sourceSha256"]})
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n")
