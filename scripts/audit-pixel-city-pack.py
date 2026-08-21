"""Read-only contract and style audit for the active Tasktopia runtime sprites."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "assets" / "pixel-city-pack"
RUNTIME = PACK / "runtime"
MANIFEST_PATH = PACK / "manifest.json"
AI_PROP_CATALOG_PATH = PACK / "catalog" / "ai-authored-props.json"
BUILDING_STUDY_ROOT = PACK / "reference" / "ai-authored" / "building-stage-study"
CELL = 8
PALETTE_BUDGET = 32
GAS_STATION_KEYS = {
    "commercial-gas-station",
    "commercial-gas-station-compact",
    "commercial-highway-service-plaza",
    "commercial-gas-station-electric",
    "commercial-gas-station-truck",
    "commercial-gas-station-cafe",
    "commercial-gas-station-wash",
}


def minimum_finished_height_ratio(key: str, canvas_height: int) -> float:
    """Use the accepted building geometry instead of a generic tall-building ratio."""
    contract_path = BUILDING_STUDY_ROOT / f"{key}-v5" / "geometry.json"
    if not contract_path.is_file() or canvas_height <= 0:
        return 0.6
    contract = json.loads(contract_path.read_text())
    height_range = contract.get("finishedOccupiedHeightPxRange")
    if not isinstance(height_range, list) or len(height_range) != 2:
        return 0.6
    return float(height_range[0]) / canvas_height


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
    gas_station_finished: dict[str, bytes] = {}

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
        if building.get("constructionStages", True) and len(stage_bytes) == 5 and len(set(stage_bytes)) != 5:
            violations.append(f"{key}: construction stages contain duplicate images")
        if key in GAS_STATION_KEYS and len(stage_bytes) == 5:
            gas_station_finished[key] = stage_bytes[-1]
            if height < 32:
                violations.append(f"{key}: fuel-station canvas needs at least 32px height for a readable silhouette")
            finished = load_image(stages[-1], f"{key}/finished-readability", violations)
            if finished is not None:
                bounds = finished.getchannel("A").getbbox()
                minimum_height_ratio = minimum_finished_height_ratio(key, height)
                if (
                    bounds is None
                    or bounds[2] - bounds[0] < width * 0.8
                    or bounds[3] - bounds[1] < height * minimum_height_ratio
                ):
                    violations.append(f"{key}: finished fuel-station silhouette is too small at native scale")

    if set(gas_station_finished) != GAS_STATION_KEYS:
        violations.append("fuel stations: expected seven registered roadside variants")
    elif len(set(gas_station_finished.values())) != len(GAS_STATION_KEYS):
        violations.append("fuel stations: finished variants must not share the same drawing")

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
        bounds = image.getchannel("A").getbbox()
        minimum_opaque_bounds = {
            "city-bus-horizontal": (44, 14),
            "city-bus-north": (13, 44),
            "city-bus-south": (13, 44),
            "bus-stop-horizontal": (14, 12),
            "bus-stop-vertical": (9, 15),
            "fountain-large": (26, 31),
            "gazebo": (27, 31),
            "playground-carousel": (30, 13),
        }
        minimum = minimum_opaque_bounds.get(key)
        if minimum and (bounds is None or bounds[2] - bounds[0] < minimum[0] or bounds[3] - bounds[1] < minimum[1]):
            violations.append(f"props/{key}: authored subject is too small for its runtime footprint")

    ai_prop_entries = json.loads(AI_PROP_CATALOG_PATH.read_text()) if AI_PROP_CATALOG_PATH.exists() else []
    for authored in ai_prop_entries:
        key = authored["key"]
        prop = manifest.get("props", {}).get(key)
        if prop is None:
            violations.append(f"props/{key}: reviewed AI-authored asset is absent from manifest")
            continue
        if prop.get("artSource") != authored.get("artSource", "AI_AUTHORED") or prop.get("sourceSheet") != authored.get("sheet"):
            violations.append(f"props/{key}: approved source provenance was lost")
        if prop.get("visualProfile") != authored.get("visualProfile"):
            violations.append(f"props/{key}: wrong or missing strict visual profile")
        if prop.get("size") != authored.get("size") or prop.get("footprintCells") != authored.get("footprintCells"):
            violations.append(f"props/{key}: runtime geometry diverges from reviewed catalog")
        if not (PACK / "reference" / authored.get("sheet", "")).is_file():
            violations.append(f"props/{key}: reviewed source sheet is missing")

    vehicle_masks: dict[str, list[bytes]] = {"horizontal": [], "north": [], "south": []}
    vehicle_drawings: dict[str, list[bytes]] = {"horizontal": [], "north": [], "south": []}
    vehicles = manifest.get("vehicles", {})
    if len(vehicles) < 6:
        violations.append("vehicles: expected at least six distinct models")
    for variant, orientations in vehicles.items():
        if set(orientations) != {"horizontal", "north", "south"}:
            violations.append(f"vehicles/{variant}: expected exactly horizontal, north and south views")
        for orientation, expected_size in (("horizontal", (16, 8)), ("north", (8, 16)), ("south", (8, 16))):
            item = orientations.get(orientation)
            if not item:
                violations.append(f"vehicles/{variant}: missing {orientation}")
                continue
            image = audit_grid_asset(item["path"], f"vehicles/{variant}/{orientation}", expected_size)
            if image is None:
                continue
            vehicle_masks[orientation].append(image.getchannel("A").tobytes())
            vehicle_drawings[orientation].append(image.tobytes())
            bounds = image.getchannel("A").getbbox()
            if orientation in {"north", "south"} and bounds and (bounds[2] - bounds[0] < 6 or bounds[3] - bounds[1] < 13):
                violations.append(f"vehicles/{variant}/{orientation}: car is too small to read in its lane")
            if orientation == "horizontal" and bounds and (bounds[2] - bounds[0] < 13 or bounds[3] - bounds[1] < 6):
                violations.append(f"vehicles/{variant}/horizontal: car is too small to read in its lane")
            if item.get("artSource") != "AI_AUTHORED" or not item.get("sourceSheet"):
                violations.append(f"vehicles/{variant}/{orientation}: missing approved AI-authored provenance")
            if item.get("visualProfile") != "TASKTOPIA_V5_OBLIQUE_ROAD_VEHICLE":
                violations.append(f"vehicles/{variant}/{orientation}: wrong V5 oblique-road visual profile")
            expected_facing = "EAST" if orientation == "horizontal" else orientation.upper()
            if item.get("baseFacing") != expected_facing:
                violations.append(f"vehicles/{variant}/{orientation}: base view must face {expected_facing}")
        horizontal = orientations.get("horizontal")
        north = orientations.get("north")
        south = orientations.get("south")
        if horizontal and north and south:
            horizontal_image = load_image(horizontal["path"], f"vehicles/{variant}/horizontal", violations)
            north_image = load_image(north["path"], f"vehicles/{variant}/north", violations)
            south_image = load_image(south["path"], f"vehicles/{variant}/south", violations)
            if horizontal_image and north_image and horizontal_image.tobytes() == north_image.transpose(Image.Transpose.ROTATE_270).tobytes():
                violations.append(f"vehicles/{variant}: north view is a mechanical side rotation")
            if north_image and south_image and north_image.tobytes() == south_image.transpose(Image.Transpose.FLIP_TOP_BOTTOM).tobytes():
                violations.append(f"vehicles/{variant}: south view is a mechanical north flip")
    for orientation, masks in vehicle_masks.items():
        drawings = vehicle_drawings[orientation]
        if drawings and len(set(drawings)) != len(drawings):
            violations.append(f"vehicles/{orientation}: model drawings must be visually unique")

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
        "vehicleModels": len(manifest.get("vehicles", {})),
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
