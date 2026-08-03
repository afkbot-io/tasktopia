"""Read-only contract and style audit for the Tasktopia V4 runtime sprites."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "assets" / "pixel-city-pack-v4"
RUNTIME = PACK / "runtime"
MANIFEST_PATH = PACK / "manifest.json"
CELL = 8
PALETTE_BUDGET = 32


def alpha_contract(image: Image.Image, label: str, violations: list[str]) -> tuple[int, int, int, int] | None:
    rgba = image.convert("RGBA")
    alpha = rgba.getchannel("A")
    bounds = alpha.getbbox()
    if bounds is None:
        violations.append(f"{label}: empty alpha")
        return None
    alpha_values = alpha.getcolors(maxcolors=256)
    if alpha_values is None or any(value not in (0, 255) for _, value in alpha_values):
        violations.append(f"{label}: soft alpha")
    return bounds


def load_image(relative_path: str, label: str, violations: list[str]) -> Image.Image | None:
    path = RUNTIME / relative_path
    if not path.is_file():
        violations.append(f"{label}: missing {relative_path}")
        return None
    try:
        return Image.open(path).convert("RGBA")
    except OSError as error:
        violations.append(f"{label}: unreadable {relative_path}: {error}")
        return None


def audit() -> dict[str, Any]:
    manifest = json.loads(MANIFEST_PATH.read_text())
    violations: list[str] = []
    referenced: set[str] = set()
    palette_counts: Counter[str] = Counter()
    category_counts: Counter[str] = Counter()

    if manifest.get("gridPx") != CELL:
        violations.append(f"manifest: gridPx must be {CELL}")
    if manifest.get("runtimeAI") is not False:
        violations.append("manifest: runtimeAI must be false")

    for key, building in manifest.get("buildings", {}).items():
        category_counts[str(building.get("category"))] += 1
        width, height = building.get("spriteSize", [0, 0])
        footprint_width, footprint_height = building.get("footprintCells", [0, 0])
        if width <= 0 or height <= 0 or width % CELL or height % CELL:
            violations.append(f"{key}: sprite canvas must use positive {CELL}px units")
        if footprint_width <= 0 or footprint_height <= 0:
            violations.append(f"{key}: invalid footprint")
        if width != footprint_width * CELL:
            violations.append(f"{key}: canvas width {width} does not match footprint width {footprint_width}x{CELL}")
        if building.get("anchorPx") != [width // 2, height]:
            violations.append(f"{key}: anchor must be bottom-center")
        stages = building.get("stages", [])
        if len(stages) != 5 or len(set(stages)) != 5:
            violations.append(f"{key}: expected five unique construction stages")
        stage_bytes: list[bytes] = []
        for stage_index, relative_path in enumerate(stages, 1):
            referenced.add(relative_path)
            expected_suffix = f"stage-{stage_index}.png"
            if not relative_path.endswith(expected_suffix):
                violations.append(f"{key}: stage {stage_index} path must end with {expected_suffix}")
            image = load_image(relative_path, f"{key}/stage-{stage_index}", violations)
            if image is None:
                continue
            if image.size != (width, height):
                violations.append(f"{key}/stage-{stage_index}: expected {(width, height)}, got {image.size}")
            bounds = alpha_contract(image, f"{key}/stage-{stage_index}", violations)
            if bounds is not None and bounds[3] < height - 1:
                violations.append(f"{key}/stage-{stage_index}: sprite no longer rests on its bottom anchor")
            palette = len(image.getcolors(maxcolors=65_536) or [])
            palette_counts[key] = max(palette_counts[key], palette)
            if palette > PALETTE_BUDGET:
                violations.append(f"{key}/stage-{stage_index}: palette {palette} exceeds {PALETTE_BUDGET} colors")
            stage_bytes.append(image.tobytes())
        if len(stage_bytes) == 5 and len(set(stage_bytes)) != 5:
            violations.append(f"{key}: construction stages contain duplicate images")

    def audit_grid_asset(relative_path: str, label: str, expected_size: tuple[int, int] | None = None) -> Image.Image | None:
        referenced.add(relative_path)
        image = load_image(relative_path, label, violations)
        if image is None:
            return None
        if expected_size and image.size != expected_size:
            violations.append(f"{label}: expected {expected_size}, got {image.size}")
        elif not expected_size and (image.width % CELL or image.height % CELL):
            violations.append(f"{label}: dimensions {image.size} are not aligned to {CELL}px")
        alpha_contract(image, label, violations)
        return image

    for family, paths in manifest.get("terrain", {}).items():
        if len(paths) < 3:
            violations.append(f"terrain/{family}: expected at least three variants")
        for index, relative_path in enumerate(paths):
            audit_grid_asset(relative_path, f"terrain/{family}/{index}", (CELL, CELL))

    for material, directions in manifest.get("transitions", {}).items():
        if set(directions) != set("NESW"):
            violations.append(f"transitions/{material}: expected N/E/S/W")
        for direction, relative_path in directions.items():
            audit_grid_asset(relative_path, f"transitions/{material}/{direction}", (CELL, CELL))

    forbidden_topology = ("intersection", "t-junction", "corner-road", "road-corner")
    for key, value in manifest.get("tiles", {}).items():
        if any(token in key for token in forbidden_topology):
            violations.append(f"tiles/{key}: prebuilt road topology is forbidden")
        relative_path = value["path"] if isinstance(value, dict) else value
        audit_grid_asset(relative_path, f"tiles/{key}", (CELL, CELL))

    for key, prop in manifest.get("props", {}).items():
        image = audit_grid_asset(prop["path"], f"props/{key}")
        if image is None:
            continue
        if prop.get("size") != [image.width, image.height]:
            violations.append(f"props/{key}: manifest size does not match PNG")
        if prop.get("anchorPx") != [image.width // 2, image.height]:
            violations.append(f"props/{key}: anchor must be bottom-center")

    vehicle_masks: dict[str, list[bytes]] = {"vertical": [], "horizontal": []}
    for color, orientations in manifest.get("vehicles", {}).items():
        for orientation, expected_size in (("vertical", (8, 16)), ("horizontal", (16, 8))):
            item = orientations.get(orientation)
            if not item:
                violations.append(f"vehicles/{color}: missing {orientation}")
                continue
            image = audit_grid_asset(item["path"], f"vehicles/{color}/{orientation}", expected_size)
            if image is None:
                continue
            vehicle_masks[orientation].append(image.getchannel("A").tobytes())
            bounds = image.getchannel("A").getbbox()
            if orientation == "vertical" and bounds and (bounds[0], bounds[2]) != (0, 8):
                violations.append(f"vehicles/{color}/vertical: car does not use full readable lane width")
            if orientation == "horizontal" and bounds and (bounds[1], bounds[3]) != (0, 8):
                violations.append(f"vehicles/{color}/horizontal: car does not use full readable lane height")
        vertical = orientations.get("vertical")
        horizontal = orientations.get("horizontal")
        if vertical and horizontal:
            vertical_image = load_image(vertical["path"], f"vehicles/{color}/vertical", violations)
            horizontal_image = load_image(horizontal["path"], f"vehicles/{color}/horizontal", violations)
            if vertical_image and horizontal_image and horizontal_image.tobytes() == vertical_image.transpose(Image.Transpose.ROTATE_270).tobytes():
                violations.append(f"vehicles/{color}: horizontal view is a mechanical rotation")
    for orientation, masks in vehicle_masks.items():
        if masks and len(set(masks)) != 1:
            violations.append(f"vehicles/{orientation}: color variants changed geometry")

    runtime_pngs = {str(path.relative_to(RUNTIME)) for path in RUNTIME.rglob("*.png")}
    orphan_pngs = sorted(runtime_pngs - referenced)
    missing_references = sorted(referenced - runtime_pngs)
    if orphan_pngs:
        violations.append(f"runtime: {len(orphan_pngs)} orphan PNG files")
    if missing_references:
        violations.append(f"runtime: {len(missing_references)} missing referenced PNG files")

    return {
        "version": manifest.get("version"),
        "gridPx": manifest.get("gridPx"),
        "buildings": len(manifest.get("buildings", {})),
        "buildingStages": sum(len(building.get("stages", [])) for building in manifest.get("buildings", {}).values()),
        "categories": dict(sorted(category_counts.items())),
        "terrainFamilies": len(manifest.get("terrain", {})),
        "props": len(manifest.get("props", {})),
        "vehicleColors": len(manifest.get("vehicles", {})),
        "referencedPngs": len(referenced),
        "runtimePngs": len(runtime_pngs),
        "maximumBuildingPalette": max(palette_counts.values(), default=0),
        "paletteBudget": PALETTE_BUDGET,
        "orphanPngs": orphan_pngs,
        "missingReferences": missing_references,
        "violations": violations,
    }


def main() -> None:
    report = audit()
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if report["violations"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
