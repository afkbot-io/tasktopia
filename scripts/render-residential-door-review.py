#!/usr/bin/env python3
"""Render low-rise residential entrances against the canonical door ruler."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "assets/pixel-city-pack/catalog/buildings.json"
RUNTIME = ROOT / "assets/pixel-city-pack/runtime/buildings/house"
STUDIES = ROOT / "assets/pixel-city-pack/reference/ai-authored/building-stage-study"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--scale", type=int, default=4)
    return parser.parse_args()


def door_evidence_sha256(review: dict[str, object], runtime_sha256: str) -> str:
    evidence = {
        "leafBoundsPx": review["leafBoundsPx"],
        "moduleBoundsPx": review["moduleBoundsPx"],
        "runtimeStage5Sha256": runtime_sha256,
    }
    payload = json.dumps(evidence, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def entrance_crop(building: dict[str, object], scale: int) -> Image.Image:
    key = str(building["key"])
    image = Image.open(RUNTIME / key / "stage-5.png").convert("RGBA")
    runtime_sha256 = hashlib.sha256((RUNTIME / key / "stage-5.png").read_bytes()).hexdigest()
    geometry = json.loads((STUDIES / f"{key}-v5" / "geometry.json").read_text())
    entrance = geometry["entrance"]
    module_width, module_height = geometry["doorSizePx"]
    leaf_width, leaf_height = geometry["doorLeafSizePx"]
    center_x = int(entrance["offset"]) * 8
    baseline_y = image.height - int(geometry.get("doorBottomInsetPx", 0))

    annotated = image.copy()
    draw = ImageDraw.Draw(annotated)
    review = geometry["doorVisualReview"]
    if review.get("reviewedStage5Sha256") != runtime_sha256:
        raise ValueError(f"{key}: door visual review is stale for the current stage-5 sprite")
    if review.get("reviewedEvidenceSha256") != door_evidence_sha256(review, runtime_sha256):
        raise ValueError(f"{key}: door visual review is stale for the current geometry")
    if not review["moduleMatchesVisibleEntrance"] or not review["leavesMatchVisibleDoorPixels"]:
        raise ValueError(f"{key}: door visual review is not accepted")
    module_left, module_top, module_right, module_bottom = review["moduleBoundsPx"]
    leaf_left, leaf_top, leaf_right, leaf_bottom = review["leafBoundsPx"]
    if [module_right - module_left, module_bottom - module_top] != [module_width, module_height]:
        raise ValueError(f"{key}: reviewed module bounds do not match the geometry contract")
    if [leaf_right - leaf_left, leaf_bottom - leaf_top] != [leaf_width, leaf_height]:
        raise ValueError(f"{key}: reviewed leaf bounds do not match the geometry contract")
    if module_bottom != baseline_y or leaf_bottom != baseline_y:
        raise ValueError(f"{key}: reviewed door does not share the placement baseline")
    draw.rectangle(
        (module_left, module_top, module_right - 1, module_bottom - 1),
        outline=(61, 211, 255, 255),
    )
    draw.rectangle(
        (leaf_left, leaf_top, leaf_right - 1, leaf_bottom - 1),
        outline=(255, 105, 180, 255),
    )

    crop_width = min(64, image.width)
    crop_height = min(48, image.height)
    crop_left = max(0, min(image.width - crop_width, center_x - crop_width // 2))
    crop_top = max(0, image.height - crop_height)
    crop = annotated.crop((crop_left, crop_top, crop_left + crop_width, image.height))
    return crop.resize((crop.width * scale, crop.height * scale), Image.Resampling.NEAREST)


def main() -> None:
    args = parse_args()
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))["buildings"]
    buildings = [building for building in catalog if "low-rise-residential" in building.get("tags", [])]
    rows: list[Image.Image] = []
    font = ImageFont.load_default()
    for building in buildings:
        crop = entrance_crop(building, args.scale)
        row = Image.new("RGB", (crop.width + 300, max(crop.height, 64)), (20, 31, 36))
        row.paste(crop, (0, 0), crop)
        draw = ImageDraw.Draw(row)
        key = str(building["key"])
        geometry = json.loads((STUDIES / f"{key}-v5" / "geometry.json").read_text())
        draw.text((crop.width + 12, 12), key, fill=(239, 236, 215), font=font)
        draw.text(
            (crop.width + 12, 30),
            f"canvas {building['spriteSize'][0]}x{building['spriteSize'][1]}  footprint {building['footprintCells'][0]}x{building['footprintCells'][1]}",
            fill=(165, 187, 190),
            font=font,
        )
        draw.text((crop.width + 12, 48), "cyan 16x16 module / magenta 12x14 leaves", fill=(165, 187, 190), font=font)
        rows.append(row)

    width = max(row.width for row in rows)
    height = sum(row.height for row in rows)
    sheet = Image.new("RGB", (width, height), (13, 25, 29))
    y = 0
    for row in rows:
        sheet.paste(row, (0, y))
        y += row.height
    args.output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.output, optimize=True)
    print(json.dumps({"output": str(args.output), "buildings": len(buildings)}))


if __name__ == "__main__":
    main()
