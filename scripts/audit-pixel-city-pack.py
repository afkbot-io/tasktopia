"""Read-only contract and style audit for the active Tasktopia runtime sprites."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

from PIL import Image

from compact_asset_contract import audit_compact_building
from micro_ambient_contract import audit_micro_ambient
from city_transport_contract import audit_city_transport


ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "assets" / "pixel-city-pack"
RUNTIME = PACK / "runtime"
MANIFEST_PATH = PACK / "manifest.json"
AI_PROP_CATALOG_PATH = PACK / "catalog" / "ai-authored-props.json"
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
    violations.extend(audit_compact_building(manifest, RUNTIME, PACK))

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

    block_surfaces = manifest.get("blockSurfaces", {})
    if block_surfaces.get("cellPx") != 4:
        violations.append("blockSurfaces: cellPx must be 4")
    if block_surfaces.get("visualProfile") != "TASKTOPIA_BLOCK_V1_MICRO_SURFACES_2026":
        violations.append("blockSurfaces: wrong visual profile")
    if list(block_surfaces.get("tiles", {})) != ["block-lawn", "block-water"]:
        violations.append("blockSurfaces: expected only block-lawn and block-water")
    for key, value in block_surfaces.get("tiles", {}).items():
        image = audit_grid_asset(value["path"], f"blockSurfaces/{key}", (4, 4))
        if image is None:
            continue
        if image.getchannel("A").getextrema() != (255, 255):
            violations.append(f"blockSurfaces/{key}: full base tile must be opaque")
        pixels = image.load()
        if any(pixels[x, 0] != pixels[x, 3] for x in range(4)):
            violations.append(f"blockSurfaces/{key}: vertical repeated-field seam")
        if any(pixels[0, y] != pixels[3, y] for y in range(4)):
            violations.append(f"blockSurfaces/{key}: horizontal repeated-field seam")

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
            "bus-stop-horizontal": (14, 12),
            "bus-stop-vertical": (9, 15),
            "fountain-large": (26, 31),
            "gazebo": (27, 31),
            "playground-carousel": (30, 13),
        }
        minimum = minimum_opaque_bounds.get(key)
        if minimum and (bounds is None or bounds[2] - bounds[0] < minimum[0] or bounds[3] - bounds[1] < minimum[1]):
            violations.append(f"props/{key}: authored subject is too small for its runtime footprint")
        if key.startswith("tree-") and prop.get("footprintCells") == [1, 1]:
            alpha = image.getchannel("A")
            contact = [x for y in range(max(0, image.height - 4), image.height)
                       for x in range(image.width) if alpha.getpixel((x, y)) > 0]
            anchor_x = image.width / 2 - 0.5
            if not contact or abs(sum(contact) / len(contact) - anchor_x) > 1.5:
                violations.append(f"props/{key}: tree ground contact is not centred on its 8x8 cell")

    prop_atlas = manifest.get("propAtlas", {})
    atlas_path = prop_atlas.get("path")
    if not isinstance(atlas_path, str):
        violations.append("propAtlas: missing runtime path")
    else:
        referenced.add(atlas_path)
        atlas_image = load_image(atlas_path, "propAtlas", violations)
        if atlas_image is not None and list(atlas_image.size) != prop_atlas.get("size"):
            violations.append("propAtlas: manifest size does not match PNG")
    atlas_frames = prop_atlas.get("frames", {})
    if set(atlas_frames) != set(manifest.get("props", {})):
        violations.append("propAtlas: frames must match the complete prop catalog")

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


    violations.extend(audit_micro_ambient(manifest, RUNTIME, PACK))
    violations.extend(audit_city_transport(manifest, RUNTIME, PACK))
    for key, entry in manifest.get("cityTransport", {}).get("sprites", {}).items():
        audit_grid_asset(entry["path"], key, (24, 24))
    for key, entry in manifest.get("microAmbient", {}).get("sprites", {}).items():
        audit_grid_asset(entry["path"], key, tuple(entry["size"]))
    for index, path in enumerate(manifest.get("atlasClouds", [])):
        audit_grid_asset(path, f"atlasClouds/{index}", (64, 32))
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
        "microAmbientSprites": len(manifest.get("microAmbient", {}).get("sprites", {})),
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
