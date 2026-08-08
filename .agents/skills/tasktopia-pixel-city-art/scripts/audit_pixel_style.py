#!/usr/bin/env python3
"""Audit the complete Tasktopia Pixel City pack and building-stage continuity."""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
from typing import Any

from PIL import Image, ImageChops


CELL = 8
PALETTE_BUDGET = 32


def opaque_bounds(image: Image.Image) -> tuple[int, int, int, int] | None:
    return image.getchannel("A").getbbox()


def coverage(image: Image.Image) -> float:
    alpha = image.getchannel("A")
    opaque = sum(count for count, value in (alpha.getcolors(maxcolors=256) or []) if value)
    return opaque / (image.width * image.height)


def mask_difference(left: Image.Image, right: Image.Image) -> float:
    diff = ImageChops.difference(left.getchannel("A"), right.getchannel("A"))
    changed = sum(count for count, value in (diff.getcolors(maxcolors=256) or []) if value)
    return changed / (left.width * left.height)


def silhouette_signature(image: Image.Image) -> bytes:
    return image.getchannel("A").point(lambda value: 255 if value else 0).tobytes()


def audit(manifest_path: Path, runtime: Path) -> dict[str, Any]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    errors: list[str] = []
    warnings: list[str] = []
    metrics: dict[str, Any] = {}
    category_signatures: dict[str, dict[bytes, list[str]]] = defaultdict(lambda: defaultdict(list))
    audited_paths: set[str] = set()

    def audit_image(relative: str, label: str, *, expected_size: tuple[int, int] | None = None) -> Image.Image | None:
        path = runtime / relative
        audited_paths.add(relative)
        if not path.is_file():
            errors.append(f"{label}: missing {relative}")
            return None
        image = Image.open(path).convert("RGBA")
        if expected_size is not None and image.size != expected_size:
            errors.append(f"{label}: expected {expected_size}, got {image.size}")
        if min(image.size) <= 0 or any(value % CELL for value in image.size):
            errors.append(f"{label}: canvas must use positive {CELL}px units")
        colors = image.getcolors(maxcolors=65_536) or []
        if len(colors) > PALETTE_BUDGET:
            errors.append(f"{label}: {len(colors)} colors exceeds {PALETTE_BUDGET}")
        alpha_colors = image.getchannel("A").getcolors(maxcolors=256) or []
        if any(value not in (0, 255) for _, value in alpha_colors):
            errors.append(f"{label}: soft alpha is forbidden")
        if opaque_bounds(image) is None:
            errors.append(f"{label}: empty image")
        return image

    for key, building in sorted(manifest.get("buildings", {}).items()):
        size = tuple(building.get("spriteSize", (0, 0)))
        footprint = tuple(building.get("footprintCells", (0, 0)))
        stages = building.get("stages", [])
        label = f"buildings/{key}"
        if len(size) != 2 or min(size, default=0) <= 0 or any(value % CELL for value in size):
            errors.append(f"{label}: canvas must use positive {CELL}px units")
            continue
        if len(footprint) != 2 or min(footprint, default=0) <= 0:
            errors.append(f"{label}: invalid footprint")
        elif size[0] != footprint[0] * CELL:
            errors.append(f"{label}: canvas width must equal footprint width x {CELL}")
        if building.get("anchorPx") != [size[0] // 2, size[1]]:
            errors.append(f"{label}: anchor must be bottom-centre")
        if len(stages) != 5 or len(set(stages)) != 5:
            errors.append(f"{label}: exactly five unique stage paths are required")
            continue

        images: list[Image.Image] = []
        bounds: list[tuple[int, int, int, int]] = []
        stage_coverage: list[float] = []
        for index, relative in enumerate(stages, 1):
            image = audit_image(relative, f"{label}/stage-{index}", expected_size=size)
            if image is None:
                continue
            images.append(image)
            current_bounds = opaque_bounds(image)
            if current_bounds is None: continue
            bounds.append(current_bounds)
            if current_bounds[3] < size[1] - 1:
                errors.append(f"{label}/stage-{index}: opaque art does not reach bottom anchor")
            stage_coverage.append(coverage(image))

        if len(images) != 5 or len(bounds) != 5:
            continue
        if len({image.tobytes() for image in images}) != 5:
            errors.append(f"{label}: stages contain duplicate drawings")
        differences = [mask_difference(images[index], images[index + 1]) for index in range(4)]
        for index, difference in enumerate(differences, 1):
            if difference < 0.015:
                errors.append(f"{label}: stages {index}->{index + 1} change only {difference:.1%} of canvas")
        centres = [((left + right) / 2) for left, _, right, _ in bounds]
        if max(centres) - min(centres) > CELL:
            warnings.append(f"{label}: stage horizontal centre drifts by more than one cell")
        final_bounds = bounds[-1]
        final_width = (final_bounds[2] - final_bounds[0]) / size[0]
        final_height = (final_bounds[3] - final_bounds[1]) / size[1]
        if final_width < 0.45 or final_height < 0.45:
            warnings.append(f"{label}: finished silhouette may be too small at native scale")
        if bounds[2][3] - bounds[2][1] < (final_bounds[3] - final_bounds[1]) * 0.45:
            warnings.append(f"{label}: structural frame does not reach half of final height")
        if stage_coverage[-1] < 0.08:
            warnings.append(f"{label}: finished opaque coverage is unusually sparse")
        category_signatures[str(building.get("category", "UNKNOWN"))][silhouette_signature(images[-1])].append(key)
        metrics[key] = {
            "coverage": [round(value, 4) for value in stage_coverage],
            "stageMaskDifference": [round(value, 4) for value in differences],
            "finishedBounds": list(final_bounds),
        }

    for category, signatures in category_signatures.items():
        for keys in signatures.values():
            if len(keys) > 1:
                warnings.append(f"category/{category}: identical finished silhouettes: {', '.join(keys)}")

    for key, prop in sorted(manifest.get("props", {}).items()):
        size = tuple(prop.get("size", (0, 0)))
        label = f"props/{key}"
        image = audit_image(str(prop.get("path", "")), label, expected_size=size if len(size) == 2 else None)
        if image is None: continue
        if prop.get("anchorPx") != [image.width // 2, image.height]:
            errors.append(f"{label}: anchor must be bottom-centre")
        footprint = prop.get("footprintCells", [])
        if len(footprint) != 2 or min(footprint, default=0) <= 0:
            errors.append(f"{label}: invalid footprint")

    for family, paths in sorted(manifest.get("terrain", {}).items()):
        images = [audit_image(relative, f"terrain/{family}/{index}", expected_size=(CELL, CELL)) for index, relative in enumerate(paths)]
        complete = [image for image in images if image is not None]
        if len({image.tobytes() for image in complete}) != len(complete):
            errors.append(f"terrain/{family}: variants must be visually distinct")

    for key, tile in sorted(manifest.get("tiles", {}).items()):
        audit_image(str(tile.get("path", "")), f"tiles/{key}", expected_size=(CELL, CELL))

    for material, directions in sorted(manifest.get("transitions", {}).items()):
        for direction, relative in sorted(directions.items()):
            audit_image(relative, f"transitions/{material}/{direction}", expected_size=(CELL, CELL))

    for color, orientations in sorted(manifest.get("vehicles", {}).items()):
        for orientation, vehicle in sorted(orientations.items()):
            expected = (8, 16) if orientation == "vertical" else (16, 8)
            audit_image(str(vehicle.get("path", "")), f"vehicles/{color}/{orientation}", expected_size=expected)

    runtime_paths = {str(path.relative_to(runtime)) for path in runtime.rglob("*.png")}
    missing_from_manifest = sorted(runtime_paths - audited_paths)
    if missing_from_manifest:
        errors.append(f"runtime: {len(missing_from_manifest)} unregistered PNG(s): {', '.join(missing_from_manifest[:8])}")

    return {
        "manifest": str(manifest_path),
        "runtime": str(runtime),
        "buildings": len(manifest.get("buildings", {})),
        "props": len(manifest.get("props", {})),
        "auditedPngs": len(audited_paths),
        "errors": errors,
        "warnings": warnings,
        "metrics": metrics,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    report = audit(args.manifest, args.runtime)
    output = json.dumps(report, ensure_ascii=False, indent=2)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(output + "\n", encoding="utf-8")
    print(output)
    if report["errors"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
