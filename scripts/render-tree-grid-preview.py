#!/usr/bin/env python3
"""Render every V5 tree on its exact one-cell planting anchor."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
CELL = 8
PANEL_COLUMNS = 7
PANEL_ROWS = 6
SHEET_COLUMNS = 4


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--manifest",
        type=Path,
        default=ROOT / "assets/pixel-city-pack/manifest.json",
    )
    parser.add_argument(
        "--runtime",
        type=Path,
        default=ROOT / "assets/pixel-city-pack/runtime",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=ROOT / "tmp/v5-tree-planting-grid.png",
    )
    parser.add_argument(
        "--preview-output",
        type=Path,
        default=ROOT / "tmp/v5-tree-planting-grid-4x.png",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    tree_entries = sorted(
        (
            (key, value)
            for key, value in manifest["props"].items()
            if value.get("visualProfile") == "TASKTOPIA_V5_TREE_FRONTAL_TOP"
        ),
        key=lambda item: item[0],
    )
    if not tree_entries:
        raise SystemExit("manifest contains no V5 trees")

    rows = (len(tree_entries) + SHEET_COLUMNS - 1) // SHEET_COLUMNS
    panel_size = (PANEL_COLUMNS * CELL, PANEL_ROWS * CELL)
    sheet = Image.new(
        "RGBA",
        (SHEET_COLUMNS * panel_size[0], rows * panel_size[1]),
        (71, 94, 64, 255),
    )
    pavement = Image.open(
        args.runtime / manifest["tiles"]["pavement"]["path"]
    ).convert("RGBA")
    if pavement.size != (CELL, CELL):
        raise SystemExit(f"pavement must be 8x8, got {pavement.size}")

    report: dict[str, object] = {"cellSizePx": CELL, "trees": {}}
    for index, (key, entry) in enumerate(tree_entries):
        if entry.get("size") != [16, 32]:
            raise SystemExit(f"{key}: expected 16x32 canvas")
        if entry.get("footprintCells") != [1, 1]:
            raise SystemExit(f"{key}: expected 1x1 footprint")
        if entry.get("anchorPx") != [8, 32]:
            raise SystemExit(f"{key}: expected anchor [8,32]")

        panel_x = (index % SHEET_COLUMNS) * panel_size[0]
        panel_y = (index // SHEET_COLUMNS) * panel_size[1]
        for row in range(PANEL_ROWS):
            for column in range(PANEL_COLUMNS):
                sheet.alpha_composite(
                    pavement,
                    (panel_x + column * CELL, panel_y + row * CELL),
                )

        anchor_x = panel_x + (PANEL_COLUMNS // 2) * CELL + CELL // 2
        anchor_y = panel_y + (PANEL_ROWS - 1) * CELL
        sprite = Image.open(args.runtime / entry["path"]).convert("RGBA")
        sheet.alpha_composite(sprite, (anchor_x - 8, anchor_y - 32))

        draw = ImageDraw.Draw(sheet)
        planting_box = (
            anchor_x - CELL // 2,
            anchor_y - CELL,
            anchor_x + CELL // 2 - 1,
            anchor_y - 1,
        )
        draw.rectangle(planting_box, outline=(65, 205, 229, 255), width=1)
        draw.line(
            (planting_box[0], anchor_y - 2, planting_box[2], anchor_y - 2),
            fill=(242, 200, 75, 255),
            width=1,
        )
        report["trees"][key] = {
            "size": entry["size"],
            "footprintCells": entry["footprintCells"],
            "anchorPx": entry["anchorPx"],
            "plantingCell": [4, 24, 12, 32],
            "groundContactRows": [30, 31],
        }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.preview_output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.output, optimize=True)
    sheet.resize(
        (sheet.width * 4, sheet.height * 4),
        Image.Resampling.NEAREST,
    ).save(args.preview_output, optimize=True)
    report["output"] = str(args.output)
    report["previewOutput"] = str(args.preview_output)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
