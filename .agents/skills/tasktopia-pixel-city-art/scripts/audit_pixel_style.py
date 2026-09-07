#!/usr/bin/env python3
"""Audit the complete Tasktopia Pixel City pack and building-stage continuity."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

from PIL import Image, ImageChops

REPOSITORY = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPOSITORY / "scripts"))
from compact_asset_contract import audit_compact_building
from micro_ambient_contract import audit_micro_ambient


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
    errors.extend(audit_compact_building(manifest, runtime, manifest_path.parent))

    def audit_image(
        relative: str,
        label: str,
        *,
        expected_size: tuple[int, int] | None = None,
        grid_unit: int = CELL,
    ) -> Image.Image | None:
        path = runtime / relative
        audited_paths.add(relative)
        if not path.is_file():
            errors.append(f"{label}: missing {relative}")
            return None
        image = Image.open(path).convert("RGBA")
        if expected_size is not None and image.size != expected_size:
            errors.append(f"{label}: expected {expected_size}, got {image.size}")
        if min(image.size) <= 0 or any(value % grid_unit for value in image.size):
            errors.append(f"{label}: canvas must use positive {grid_unit}px units")
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
        if key.startswith("tree-") and footprint == [1, 1]:
            alpha = image.getchannel("A")
            contact = [x for y in range(max(0, image.height - 4), image.height)
                       for x in range(image.width) if alpha.getpixel((x, y)) > 0]
            anchor_x = image.width / 2 - 0.5
            if not contact or abs(sum(contact) / len(contact) - anchor_x) > 1.5:
                errors.append(f"{label}: tree ground contact is not centred on its 8x8 cell")
        bounds = opaque_bounds(image)
        minimum_opaque_bounds = {
            "bus-stop-horizontal": (14, 12),
            "bus-stop-vertical": (9, 15),
            "fountain-large": (26, 31),
            "gazebo": (27, 31),
            "playground-carousel": (30, 13),
        }
        minimum = minimum_opaque_bounds.get(key)
        if minimum and (bounds is None or bounds[2] - bounds[0] < minimum[0] or bounds[3] - bounds[1] < minimum[1]):
            errors.append(f"{label}: authored subject is too small for its runtime footprint")
        if key.startswith("tree-"):
            if prop.get("visualProfile") != "TASKTOPIA_V7_TREE_COMPACT_45_GRID":
                errors.append(f"{label}: retired tree profile")
            if image.size != (16, 16):
                errors.append(f"{label}: compact tree canvas must be 16x16")
            if footprint != [1, 1]:
                errors.append(f"{label}: compact tree footprint must be 1x1")
            if prop.get("anchorPx") != [8, 16]:
                errors.append(f"{label}: compact tree anchor must be [8, 16]")
            visible_bounds = image.getbbox()
            visible_height = visible_bounds[3] - visible_bounds[1] if visible_bounds else 0
            minimum_height, maximum_height = (6, 9) if key == "tree-deadwood" else (8, 14)
            if visible_bounds and visible_bounds[2] - visible_bounds[0] > 12:
                errors.append(f"{label}: crown exceeds 12px compact clearance envelope")
            if not minimum_height <= visible_height <= maximum_height:
                errors.append(
                    f"{label}: high-45 visible height must be {minimum_height}..{maximum_height}px, "
                    f"got {visible_height}px"
                )
            # A high-45 crown keeps most occupied rows close to its maximum
            # width. Front-facing cones and round icons narrow for too long.
            # Deadwood is intentionally a low stump and shares only the
            # anchor/planting-cell checks below.
            if key not in ("tree-deadwood", "tree-palm"):
                crown_widths = []
                for y in range(0, image.height - 3):
                    occupied_x = [x for x in range(image.width) if image.getpixel((x, y))[3]]
                    if occupied_x:
                        crown_widths.append(max(occupied_x) - min(occupied_x) + 1)
                maximum_crown_width = max(crown_widths, default=0)
                broad_rows = sum(width >= maximum_crown_width - 2 for width in crown_widths)
                if maximum_crown_width < 6 or broad_rows < max(2, round(len(crown_widths) * 0.45)):
                    errors.append(
                        f"{label}: crown must remain a broad square/rectangle in the high-45 view; "
                        f"max width {maximum_crown_width}px, broad rows {broad_rows}/{len(crown_widths)}"
                    )
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

    prop_atlas = manifest.get("propAtlas", {})
    atlas_relative = prop_atlas.get("path")
    if not isinstance(atlas_relative, str):
        errors.append("propAtlas: missing runtime path")
    else:
        audited_paths.add(atlas_relative)
        atlas_path = runtime / atlas_relative
        if not atlas_path.is_file():
            errors.append(f"propAtlas: missing {atlas_relative}")
        else:
            atlas = Image.open(atlas_path).convert("RGBA")
            if list(atlas.size) != prop_atlas.get("size"):
                errors.append("propAtlas: manifest size does not match PNG")
            alpha_colors = atlas.getchannel("A").getcolors(maxcolors=256) or []
            if any(value not in (0, 255) for _, value in alpha_colors):
                errors.append("propAtlas: soft alpha is forbidden")
    if set(prop_atlas.get("frames", {})) != set(manifest.get("props", {})):
        errors.append("propAtlas: frames must match the complete prop catalog")
    elif isinstance(atlas_relative, str) and (runtime / atlas_relative).is_file():
        atlas = Image.open(runtime / atlas_relative).convert("RGBA")
        for key, prop in manifest.get("props", {}).items():
            frame = prop_atlas["frames"][key]
            atlas_frame = atlas.crop((
                frame["x"], frame["y"],
                frame["x"] + frame["width"], frame["y"] + frame["height"],
            ))
            prop_image = Image.open(runtime / prop["path"]).convert("RGBA")
            if atlas_frame.size != prop_image.size or atlas_frame.tobytes() != prop_image.tobytes():
                errors.append(f"propAtlas: {key} frame differs from {prop['path']}")

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

    for key, tile in sorted(manifest.get("blockSurfaces", {}).get("tiles", {}).items()):
        image = audit_image(
            str(tile.get("path", "")),
            f"blockSurfaces/{key}",
            expected_size=(4, 4),
            grid_unit=4,
        )
        if image is not None and image.getchannel("A").getextrema() != (255, 255):
            errors.append(f"blockSurfaces/{key}: full base tile must be opaque")

    for material, directions in sorted(manifest.get("transitions", {}).items()):
        for direction, relative in sorted(directions.items()):
            audit_image(relative, f"transitions/{material}/{direction}", expected_size=(CELL, CELL))


    errors.extend(audit_micro_ambient(manifest, runtime, manifest_path.parent))
    for key, entry in manifest.get("microAmbient", {}).get("sprites", {}).items():
        audit_image(entry["path"], key, expected_size=tuple(entry["size"]))
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
