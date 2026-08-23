#!/usr/bin/env python3
"""Compose all strict low-rise projection overlays into one review sheet."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reports-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    entries: list[tuple[str, list[tuple[str, Image.Image]]]] = []
    for report in sorted(args.reports_root.glob("house-lowrise-*/report.json")):
        payload = json.loads(report.read_text(encoding="utf-8"))
        key = report.parent.name
        stages: list[tuple[str, Image.Image]] = []
        for label, filename in (
            ("stage 3", "stage-3-geometry-4x.png"),
            ("stage 4", "stage-4-geometry-4x.png"),
            ("stage 5 projection", "stage-5-projection-4x.png"),
        ):
            overlay_path = report.parent / filename
            if not overlay_path.is_file():
                raise ValueError(f"missing {label} overlay for {key}")
            stages.append((label, Image.open(overlay_path).convert("RGBA")))
        entries.append((key, stages))
        if payload.get("errors"):
            raise ValueError(f"{key}: strict verifier has errors: {payload['errors']}")
    if len(entries) != 10:
        raise ValueError(f"expected 10 low-rise reports, got {len(entries)}")

    font = ImageFont.load_default()
    stage_width = max(image.width for _, stages in entries for _, image in stages)
    stage_height = max(image.height for _, stages in entries for _, image in stages)
    cell_width = stage_width * 3 + 40
    cell_height = stage_height + 58
    sheet = Image.new("RGB", (cell_width * 2, cell_height * 5), (13, 25, 29))
    draw = ImageDraw.Draw(sheet)
    for index, (key, stages) in enumerate(entries):
        column = index % 2
        row = index // 2
        cell_x = column * cell_width
        cell_y = row * cell_height
        draw.text((cell_x + 10, cell_y + 8), key, fill=(239, 236, 215), font=font)
        for stage_index, (label, overlay) in enumerate(stages):
            stage_x = cell_x + 10 + stage_index * stage_width + (stage_width - overlay.width) // 2
            stage_y = cell_y + 44 + stage_height - overlay.height
            sheet.paste(overlay, (stage_x, stage_y), overlay)
            draw.text(
                (cell_x + 10 + stage_index * stage_width, cell_y + 25),
                label,
                fill=(165, 187, 190),
                font=font,
            )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.output, optimize=True)
    print(json.dumps({"output": str(args.output), "buildings": len(entries)}))


if __name__ == "__main__":
    main()
