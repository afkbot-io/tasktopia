"""Blocking native micro-ambient contract shared by publisher and both audits."""
from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path

from PIL import Image

PROFILE = "TASKTOPIA_MICRO_TOPDOWN_CARTOON_V1"
# Odd-width subjects have their visible centre at x=3.5 while the 8px canvas
# anchor remains [4,4]. Every heading must retain this same registration.
PERSON_OCCUPIED_BOUNDS = (2, 2, 5, 6)


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def audit_people_provenance(source: dict, pack: Path) -> list[str]:
    """Prove that the revised source only packs unchanged AI-authored cells."""
    errors = []
    try:
        provenance_path = pack / source["provenance"]
        provenance = json.loads(provenance_path.read_text())
        if source.get("revision") != 2 or provenance.get("operation") != "EXTRACT_AND_PACK_ONLY":
            return ["microAmbient/people: missing reviewed source-v2 packing provenance"]
        authored = {}
        for name, entry in provenance["inputs"].items():
            path = provenance_path.parent / entry["path"]
            if sha(path) != entry["sha256"]:
                errors.append(f"microAmbient/people: authored {name} source changed")
            authored[name] = Image.open(path).convert("RGBA")
        output = provenance["output"]
        packed = Image.new("RGBA", tuple(output["size"]), "#ff00ff")
        for cell in provenance["cells"]:
            packed.paste(authored[cell["input"]].crop(cell["crop"]), tuple(cell["paste"]))
        current = Image.open(pack / source["path"]).convert("RGBA")
        if (current.size != packed.size or current.tobytes() != packed.tobytes()
                or output["sha256"] != source["sha256"]):
            errors.append("microAmbient/people: packed source is not unchanged authored-cell extraction")
    except (OSError, KeyError, TypeError, ValueError):
        errors.append("microAmbient/people: missing or invalid source-v2 packing provenance")
    return errors


def audit_micro_ambient(manifest: dict, runtime: Path, pack: Path) -> list[str]:
    errors = []
    if "vehicles" in manifest:
        errors.append("microAmbient: retired vehicle catalog must not be published")
    if any(key.startswith(("walker-", "resident-", "fisher-", "animal-", "cyclist-", "scooter-", "city-bus-", "airplane-", "fire-engine-")) for key in manifest.get("props", {})):
        errors.append("microAmbient: retired moving prop family must not be published")
    micro = manifest.get("microAmbient", {})
    if micro.get("visualProfile") != PROFILE or micro.get("artSource") != "AI_AUTHORED":
        return ["microAmbient: missing reviewed native top-down art profile"]
    sprites = micro.get("sprites", {})
    if Counter(entry.get("kind") for entry in sprites.values()) != {"car": 32, "person": 8, "animal": 32, "aircraft": 4}:
        errors.append("microAmbient: expected 32 cars, 8 people, 32 directional animals, 4 aircraft")
    review_path = pack / "reference/ai-authored/micro-ambient-v1/visual-review.json"
    review = json.loads(review_path.read_text()) if review_path.exists() else {}
    for family, source in micro.get("sources", {}).items():
        path = pack / source["path"]
        reviewed = review.get("sources", {}).get(family, {})
        if not path.exists() or sha(path) != source.get("sha256"):
            errors.append(f"microAmbient/{family}: missing or changed authored source")
        if not reviewed.get("accepted") or reviewed.get("sha256") != source.get("sha256"):
            errors.append(f"microAmbient/{family}: review does not approve this source")
        if family == "people":
            errors.extend(audit_people_provenance(source, pack))
    for key, entry in sprites.items():
        path = runtime / entry["path"]
        if not path.exists():
            errors.append(f"{key}: missing published PNG")
            continue
        image = Image.open(path).convert("RGBA")
        size = 16 if entry["kind"] == "aircraft" else 8
        if image.size != (size, size) or entry.get("size") != [size, size] or entry.get("anchorPx") != [size // 2, size // 2]:
            errors.append(f"{key}: wrong native canvas/centre anchor")
        if set(image.getchannel("A").getdata()) - {0, 255}:
            errors.append(f"{key}: soft alpha")
        colors = {(r, g, b) for r, g, b, a in image.getdata() if a}
        if len(colors) > 8 or any(r > g + 60 and b > g + 60 for r, g, b in colors):
            errors.append(f"{key}: palette overflow or chroma fringe")
        bounds = image.getchannel("A").getbbox()
        if not bounds or list(bounds) != entry.get("opaqueBounds"):
            errors.append(f"{key}: incorrect occupied bounds")
        if bounds:
            width, height = bounds[2] - bounds[0], bounds[3] - bounds[1]
            if entry["kind"] == "person" and bounds != PERSON_OCCUPIED_BOUNDS:
                errors.append(f"{key}: person registration must be 3x4 at [2,2,5,6] in every direction")
            maximum = (12, 12) if entry["kind"] == "aircraft" else (3, 4) if entry["kind"] == "person" else (6, 6)
            if entry["kind"] == "car":
                maximum = (6, 4) if entry["direction"] in ("east", "west") else (4, 6)
            if width > maximum[0] or height > maximum[1]:
                errors.append(f"{key}: silhouette exceeds micro envelope")
            if entry["kind"] == "animal" and max(width, height) < 4:
                errors.append(f"{key}: animal is an unreadable narrow bar")
        if entry.get("frameCount") != 1 or entry.get("direction") not in ("north", "east", "south", "west"):
            errors.append(f"{key}: static-frame contract violated")
        if sha(path) != entry.get("sha256"):
            errors.append(f"{key}: runtime changed after normalization")
    return errors


def publish_micro_ambient(manifest: dict, runtime: Path, pack: Path) -> None:
    manifest["microAmbient"] = json.loads((pack / "micro-ambient-manifest.json").read_text())
    errors = audit_micro_ambient(manifest, runtime, pack)
    if errors:
        raise ValueError("\n".join(errors))
