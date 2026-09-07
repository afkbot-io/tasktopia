"""Read-only provenance and geometry gate for the compact replacement building."""

import hashlib
import json
from pathlib import Path


PROFILE = "TASKTOPIA_COMPACT_CARTOON_HIGH_45_V1"


def audit_compact_projection(review: dict, geometry: dict) -> list[str]:
    """One annotation contract for source verification and published-pack audit.

    This checks the consistency of recorded human/AI visual measurements, not
    camera angles inferred from pixels. Independent visual review stays required.
    """
    errors = []
    if review.get("key") != geometry["key"]:
        errors.append("Visual review belongs to a different building family")
    projection = review.get("projection", {})
    for field in ("primaryRoofIsDominantSurface", "roofAndFloorLinesAreAxisAligned", "sameCameraAcrossStages", "noHeavyBlackBaseline"):
        if projection.get(field) is not True:
            errors.append(f"Visual projection assertion {field} must be reviewed and accepted")
    for field in ("doorLeafSizePx", "doorFrameSizePx"):
        if projection.get(field) != geometry.get(field):
            errors.append(f"Visual projection annotation {field} differs from immutable family geometry")
    for field, bounds in (("roofDepthPx", geometry["roofDepthPxRange"]), ("facadeHeightPx", geometry["facadeHeightPxRange"]), ("floorStepPx", geometry["floorHeightPxRange"])):
        value = projection.get(field)
        if value is None or not bounds[0] <= value <= bounds[1]:
            errors.append(f"Visual projection annotation {field} misses compact contract")
    return errors


def audit_compact_building(manifest: dict, runtime: Path, pack: Path) -> list[str]:
    errors = []
    catalog = json.loads((pack / "catalog" / "buildings.json").read_text())
    entries = catalog.get("buildings", [])
    keys = {entry["key"] for entry in entries}
    if not entries or len(keys) != len(entries) or set(manifest.get("buildings", {})) != keys:
        return ["buildings: runtime and unique reviewed compact catalog families differ"]
    if catalog.get("projectionProfile") != PROFILE:
        errors.append("buildings: compact projection required")
    for authored in entries:
        errors.extend(audit_compact_family(authored, manifest["buildings"][authored["key"]], runtime, pack))
    if any(key.startswith("construction-") for section in ("props", "tiles") for key in manifest.get(section, {})):
        errors.append("construction: legacy oversized shared kit remains active")
    return errors


def audit_compact_family(authored: dict, entry: dict, runtime: Path, pack: Path) -> list[str]:
    errors = []
    key = authored["key"]
    if not key.startswith("compact-") or not authored.get("reviewed"):
        errors.append(f"{key}: reviewed compact family required")
    family = pack / "reference" / "ai-authored" / key
    try:
        geometry = json.loads((family / "geometry.json").read_text())
        review = json.loads((family / "visual-review.json").read_text())
        report = json.loads((family / "report.json").read_text())
    except (OSError, ValueError) as error:
        return errors + [f"{key}: missing geometry/review/report: {error}"]
    for field in ("spriteSize", "footprintCells", "anchorPx", "entrances"):
        if entry.get(field) != geometry.get(field) or authored.get(field) != geometry.get(field):
            errors.append(f"{key}: {field} does not match authored compact geometry")
    if report.get("errors") or set(report.get("stages", {})) != {"3", "4", "5"}:
        errors.append(f"{key}: complete clean geometry report required")
    if "commonSourceFrame" in geometry:
        declared_frame = geometry["commonSourceFrame"]
        recorded_frame = report.get("commonSourceFrame")
        # JSON booleans/floats must not pass through Python's numeric equality.
        if any(not isinstance(frame, list) or len(frame) != 4 or
               any(type(value) is not int or abs(value) > 9007199254740991 for value in frame)
               for frame in (declared_frame, recorded_frame)):
            errors.append(f"{key}: commonSourceFrame requires four safe integer coordinates in geometry and report")
        elif recorded_frame != declared_frame:
            errors.append(f"{key}: report commonSourceFrame differs from geometry; source verification is stale")
        else:
            source_canvas = report.get("sourceCanvas")
            if (not isinstance(source_canvas, list) or len(source_canvas) != 2 or
                    any(type(value) is not int or not 0 < value <= 9007199254740991 for value in source_canvas) or
                    not (0 <= declared_frame[0] < declared_frame[2] <= source_canvas[0] and
                         0 <= declared_frame[1] < declared_frame[3] <= source_canvas[1])):
                errors.append(f"{key}: commonSourceFrame must be non-empty and inside the verified source canvas")
    if len(authored.get("stageSources", [])) != 3 or len(authored.get("stageSha256", [])) != 3:
        return errors + [f"{key}: exactly three independent source paths and hashes required"]
    for stage in (3, 4, 5):
        source = pack / "reference" / authored["stageSources"][stage - 3]
        normalized = family / "normalized" / f"stage-{stage}.png"
        try:
            source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
            normalized_hash = hashlib.sha256(normalized.read_bytes()).hexdigest()
            runtime_hash = hashlib.sha256((runtime / entry["stages"][stage - 1]).read_bytes()).hexdigest()
        except OSError as error:
            errors.append(f"{key}/{stage}: missing source or runtime: {error}")
            continue
        measured = report.get("stages", {}).get(str(stage), {})
        approved = review.get("stages", {}).get(str(stage), {})
        if authored["stageSha256"][stage - 3] != source_hash or measured.get("sourceSha256") != source_hash:
            errors.append(f"{key}/{stage}: stale source hash")
        if runtime_hash != normalized_hash or measured.get("runtimeSha256") != normalized_hash:
            errors.append(f"{key}/{stage}: runtime differs from accepted normalized source")
        if approved.get("accepted") is not True or approved.get("runtimeSha256") != normalized_hash:
            errors.append(f"{key}/{stage}: missing or stale visual approval")
        if approved.get("sourceSha256") != source_hash:
            errors.append(f"{key}/{stage}: source visual review hash differs")
    errors.extend(f"{key}: {error}" for error in audit_compact_projection(review, geometry))
    return errors
