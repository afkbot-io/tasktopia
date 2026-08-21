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


def pixel_difference(left: Image.Image, right: Image.Image) -> float:
    """Measure visible stage change, including scaffold/material repainting.

    Alpha-only comparison is useful for silhouette continuity but falsely
    rejects a near-complete construction stage whose scaffolding and unfinished
    facade occupy pixels already covered by the finished building.
    """
    diff = ImageChops.difference(left.convert("RGBA"), right.convert("RGBA"))
    changed = sum(
        1
        for pixel in diff.getdata()
        if pixel != (0, 0, 0, 0)
    )
    return changed / (left.width * left.height)


def silhouette_signature(image: Image.Image) -> bytes:
    return image.getchannel("A").point(lambda value: 255 if value else 0).tobytes()


def rgba(hex_color: str) -> tuple[int, int, int, int]:
    return tuple(bytes.fromhex(hex_color.removeprefix("#")))  # type: ignore[return-value]


def largest_component_in_right_half(image: Image.Image, color: tuple[int, int, int, int]) -> int:
    pixels = image.load()
    pending = {
        (x, y)
        for y in range(image.height)
        for x in range(image.width // 2, image.width)
        if pixels[x, y] == color
    }
    largest = 0
    while pending:
        stack = [pending.pop()]
        size = 0
        while stack:
            x, y = stack.pop()
            size += 1
            for neighbour in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if neighbour in pending:
                    pending.remove(neighbour)
                    stack.append(neighbour)
        largest = max(largest, size)
    return largest


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
        mask_differences = [mask_difference(images[index], images[index + 1]) for index in range(4)]
        pixel_differences = [pixel_difference(images[index], images[index + 1]) for index in range(4)]
        for index, difference in enumerate(pixel_differences, 1):
            if difference < 0.015:
                errors.append(f"{label}: stages {index}->{index + 1} change only {difference:.1%} of visible pixels")
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
        projection = building.get("visualProjection")
        if projection and projection.get("profile") == "FRONTAL_TOP":
            roof_color = rgba(str(projection["roofColor"]))
            side_color = rgba(str(projection["sideColor"]))
            roof_pixels = [
                (x, y)
                for y in range(images[-1].height)
                for x in range(images[-1].width)
                if images[-1].getpixel((x, y)) == roof_color
            ]
            roof_rows = {y for _, y in roof_pixels}
            side_component = largest_component_in_right_half(images[-1], side_color)
            if len(roof_pixels) < int(projection["minimumRoofPixels"]) or len(roof_rows) < int(projection["minimumRoofRows"]):
                errors.append(
                    f"{label}: frontal-top projection has no readable roof/top plane "
                    f"({len(roof_pixels)} px across {len(roof_rows)} rows)"
                )
            if side_component < int(projection["minimumSidePixels"]):
                errors.append(
                    f"{label}: frontal-top projection has no continuous shaded right plane "
                    f"({side_component} px)"
                )
        category_signatures[str(building.get("category", "UNKNOWN"))][silhouette_signature(images[-1])].append(key)
        metrics[key] = {
            "coverage": [round(value, 4) for value in stage_coverage],
            "stageMaskDifference": [round(value, 4) for value in mask_differences],
            "stagePixelDifference": [round(value, 4) for value in pixel_differences],
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
        bounds = opaque_bounds(image)
        minimum_opaque_bounds = {
            "city-bus-horizontal": (20, 7),
            "city-bus-north": (6, 18),
            "city-bus-south": (6, 18),
            "bus-stop-horizontal": (14, 12),
            "bus-stop-vertical": (9, 15),
            "fountain-large": (26, 31),
            "gazebo": (27, 31),
            "playground-carousel": (30, 13),
        }
        minimum = minimum_opaque_bounds.get(key)
        if minimum and (bounds is None or bounds[2] - bounds[0] < minimum[0] or bounds[3] - bounds[1] < minimum[1]):
            errors.append(f"{label}: authored subject is too small for its runtime footprint")
        if prop.get("visualProfile") == "TASKTOPIA_V5_RESIDENT_WALK_3_FRAME":
            if image.size != (16, 24):
                errors.append(f"{label}: walking resident canvas must be 16x24")
            if bounds is None:
                errors.append(f"{label}: walking resident has no opaque subject")
            else:
                resident_width = bounds[2] - bounds[0]
                resident_height = bounds[3] - bounds[1]
                if resident_width < 8 or resident_width > 12:
                    errors.append(f"{label}: walking resident opaque width must be 8..12 px")
                if resident_height < 16 or resident_height > 18:
                    errors.append(f"{label}: walking resident opaque height must be 16..18 px, got {resident_height}")
                if bounds[3] != image.height:
                    errors.append(f"{label}: walking resident feet must share the bottom baseline")
        if prop.get("visualProfile") == "TASKTOPIA_V5_RESIDENT_ACTIVITY":
            if image.size != (16, 24):
                errors.append(f"{label}: activity resident canvas must be 16x24")
            if bounds is None:
                errors.append(f"{label}: activity resident has no opaque subject")
            else:
                resident_width = bounds[2] - bounds[0]
                resident_height = bounds[3] - bounds[1]
                if key.startswith("fisher-"):
                    if resident_width < 8 or resident_width > 10 or resident_height < 12 or resident_height > 14:
                        errors.append(
                            f"{label}: fishing pose must occupy 8..10x12..14 px at canonical human scale, "
                            f"got {resident_width}x{resident_height}"
                        )
                elif resident_width < 8 or resident_width > 10 or resident_height < 16 or resident_height > 18:
                    errors.append(
                        f"{label}: upright activity resident must occupy 8..10x16..18 px, "
                        f"got {resident_width}x{resident_height}"
                    )
                if bounds[3] != image.height:
                    errors.append(f"{label}: activity resident feet must share the bottom baseline")
        if prop.get("visualProfile") == "TASKTOPIA_V5_MICROMOBILITY_FRONTAL_TOP":
            horizontal = "-horizontal-" in key
            expected_canvas = (24, 24) if horizontal else (16, 24)
            if image.size != expected_canvas:
                errors.append(f"{label}: micromobility canvas must be {expected_canvas[0]}x{expected_canvas[1]}")
            if bounds is None:
                errors.append(f"{label}: micromobility sprite has no opaque subject")
            else:
                subject_width = bounds[2] - bounds[0]
                subject_height = bounds[3] - bounds[1]
                if horizontal and (subject_width < 12 or subject_width > 18 or subject_height < 13 or subject_height > 18):
                    errors.append(
                        f"{label}: horizontal rider and vehicle must occupy 12..18x13..18 px, "
                        f"got {subject_width}x{subject_height}"
                    )
                if not horizontal and (subject_width < 6 or subject_width > 8 or subject_height < 16 or subject_height > 18):
                    errors.append(
                        f"{label}: vertical rider and vehicle must occupy 6..8x16..18 px, "
                        f"got {subject_width}x{subject_height}"
                    )
                if bounds[3] != image.height:
                    errors.append(f"{label}: micromobility contact point must share the bottom baseline")
        if prop.get("visualProfile") == "TASKTOPIA_V5_TREE_FRONTAL_TOP":
            if image.size != (16, 32):
                errors.append(f"{label}: standard V5 tree canvas must be 16x32")
            if footprint != [1, 1]:
                errors.append(f"{label}: standard V5 tree footprint must be 1x1")
            if prop.get("anchorPx") != [8, 32]:
                errors.append(f"{label}: standard V5 tree anchor must be [8, 32]")
            planting_top = image.height - 2
            outside_planting_cell = [
                (x, y)
                for y in range(planting_top, image.height)
                for x in range(image.width)
                if image.getpixel((x, y))[3] and not (4 <= x < 12)
            ]
            if outside_planting_cell:
                errors.append(
                    f"{label}: {len(outside_planting_cell)} opaque pixel(s) escape "
                    "the lower-centre 8x8 planting cell at ground contact"
                )
            bottom_contact = [
                x for x in range(4, 12)
                if x < image.width and image.getpixel((x, image.height - 1))[3]
            ]
            if not bottom_contact:
                errors.append(f"{label}: trunk/root does not touch the planting-cell baseline")

    ai_prop_catalog = manifest_path.parent / "catalog" / "ai-authored-props.json"
    if ai_prop_catalog.exists():
        for authored in json.loads(ai_prop_catalog.read_text(encoding="utf-8")):
            key = authored["key"]
            prop = manifest.get("props", {}).get(key)
            if prop is None:
                errors.append(f"props/{key}: reviewed AI-authored asset is absent from manifest")
                continue
            if prop.get("artSource") != authored.get("artSource", "AI_AUTHORED") or prop.get("sourceSheet") != authored.get("sheet"):
                errors.append(f"props/{key}: approved source provenance was lost")
            if prop.get("visualProfile") != authored.get("visualProfile"):
                errors.append(f"props/{key}: wrong or missing strict visual profile")
            if prop.get("size") != authored.get("size") or prop.get("footprintCells") != authored.get("footprintCells"):
                errors.append(f"props/{key}: runtime geometry diverges from reviewed catalog")

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

    vehicle_signatures: dict[str, list[bytes]] = {"horizontal": [], "north": [], "south": []}
    vehicle_drawings: dict[str, list[bytes]] = {"horizontal": [], "north": [], "south": []}
    vehicles = manifest.get("vehicles", {})
    if len(vehicles) < 6:
        errors.append("vehicles: expected at least six distinct models")
    for variant, orientations in sorted(vehicles.items()):
        if set(orientations) != {"horizontal", "north", "south"}:
            errors.append(f"vehicles/{variant}: expected exactly horizontal, north and south views")
        for orientation, vehicle in sorted(orientations.items()):
            expected = (16, 8) if orientation == "horizontal" else (8, 16)
            image = audit_image(str(vehicle.get("path", "")), f"vehicles/{variant}/{orientation}", expected_size=expected)
            if image is None:
                continue
            vehicle_signatures[orientation].append(silhouette_signature(image))
            vehicle_drawings[orientation].append(image.tobytes())
            bounds = opaque_bounds(image)
            if bounds is not None:
                width, height = bounds[2] - bounds[0], bounds[3] - bounds[1]
                if orientation == "horizontal" and (width < 13 or height < 6):
                    errors.append(f"vehicles/{variant}/horizontal: model is too small at native scale")
                if orientation in {"north", "south"} and (width < 6 or height < 13):
                    errors.append(f"vehicles/{variant}/{orientation}: model is too small at native scale")
            if vehicle.get("artSource") != "AI_AUTHORED" or not vehicle.get("sourceSheet"):
                errors.append(f"vehicles/{variant}/{orientation}: missing approved AI-authored provenance")
            if vehicle.get("visualProfile") != "TASKTOPIA_V5_OBLIQUE_ROAD_VEHICLE":
                errors.append(f"vehicles/{variant}/{orientation}: wrong V5 oblique-road visual profile")
        horizontal = orientations.get("horizontal")
        north = orientations.get("north")
        south = orientations.get("south")
        if horizontal and north and south:
            horizontal_image = Image.open(runtime / horizontal["path"]).convert("RGBA")
            north_image = Image.open(runtime / north["path"]).convert("RGBA")
            south_image = Image.open(runtime / south["path"]).convert("RGBA")
            if horizontal_image.tobytes() == north_image.transpose(Image.Transpose.ROTATE_270).tobytes():
                errors.append(f"vehicles/{variant}: north view is a mechanical side rotation")
            if north_image.tobytes() == south_image.transpose(Image.Transpose.FLIP_TOP_BOTTOM).tobytes():
                errors.append(f"vehicles/{variant}: south view is a mechanical north flip")
    for orientation, signatures in vehicle_signatures.items():
        drawings = vehicle_drawings[orientation]
        if drawings and len(set(drawings)) != len(drawings):
            errors.append(f"vehicles/{orientation}: model drawings must be visually unique")

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
