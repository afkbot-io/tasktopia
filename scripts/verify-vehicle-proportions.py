#!/usr/bin/env python3
"""Verify native vehicle proportions and render directional overlay proofs."""

from __future__ import annotations

import argparse
import itertools
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "assets/pixel-city-pack"
RUNTIME = PACK / "runtime"


def component_count(image: Image.Image) -> int:
    alpha = image.getchannel("A")
    remaining = {(x, y) for y in range(image.height) for x in range(image.width) if alpha.getpixel((x, y))}
    count = 0
    while remaining:
        count += 1
        stack = [remaining.pop()]
        while stack:
            x, y = stack.pop()
            for neighbour in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if neighbour in remaining:
                    remaining.remove(neighbour)
                    stack.append(neighbour)
    return count


def overlay(left: Image.Image, right: Image.Image) -> Image.Image:
    result = Image.new("RGBA", left.size, (0, 0, 0, 0))
    left_alpha = left.getchannel("A")
    right_alpha = right.getchannel("A")
    for y in range(result.height):
        for x in range(result.width):
            in_left = left_alpha.getpixel((x, y)) > 0
            in_right = right_alpha.getpixel((x, y)) > 0
            if in_left and in_right:
                result.putpixel((x, y), (228, 228, 220, 255))
            elif in_left:
                result.putpixel((x, y), (255, 52, 188, 255))
            elif in_right:
                result.putpixel((x, y), (36, 220, 255, 255))
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--proof", type=Path)
    args = parser.parse_args()
    manifest = json.loads((PACK / "manifest.json").read_text(encoding="utf-8"))
    models = manifest["vehicles"]
    checked: list[tuple[str, dict[str, Image.Image]]] = []
    for key, views in sorted(models.items()):
        images: dict[str, Image.Image] = {}
        for direction, expected_size, expected_bounds in (
            ("horizontal", (24, 16), (22, 13)),
            ("north", (16, 24), (13, 22)),
            ("south", (16, 24), (13, 22)),
        ):
            entry = views[direction]
            image = Image.open(RUNTIME / entry["path"]).convert("RGBA")
            assert image.size == expected_size, f"{key}/{direction}: canvas {image.size}"
            bounds = image.getchannel("A").getbbox()
            assert bounds is not None
            assert (bounds[2] - bounds[0], bounds[3] - bounds[1]) == expected_bounds, f"{key}/{direction}: bounds {bounds}"
            assert set(image.getchannel("A").getdata()) <= {0, 255}, f"{key}/{direction}: soft alpha"
            assert component_count(image) == 1, f"{key}/{direction}: disconnected body"
            assert entry.get("sourceSha256"), f"{key}/{direction}: missing source digest"
            images[direction] = image
        assert ImageChops.difference(
            images["north"], images["south"].transpose(Image.Transpose.FLIP_TOP_BOTTOM),
        ).getbbox() is not None, f"{key}: north/south are mechanical flips"
        checked.append((key, images))

    fire_engines: dict[str, Image.Image] = {}
    for key in ("fire-engine-horizontal", "fire-engine-rescue", "fire-engine-ladder"):
        entry = manifest["props"][key]
        image = Image.open(RUNTIME / entry["path"]).convert("RGBA")
        assert image.size == (48, 16), f"{key}: canvas {image.size}"
        bounds = image.getchannel("A").getbbox()
        assert bounds is not None
        assert (bounds[2] - bounds[0], bounds[3] - bounds[1]) == (46, 14), f"{key}: bounds {bounds}"
        assert set(image.getchannel("A").getdata()) <= {0, 255}, f"{key}: soft alpha"
        assert component_count(image) == 1, f"{key}: disconnected body"
        assert entry["footprintCells"] == [6, 2], f"{key}: footprint {entry['footprintCells']}"
        assert entry.get("sourceSheet") == "hand-authored/ambient/fire-engines-v4.png", f"{key}: stale source"
        fire_engines[key] = image
    for left_key, right_key in itertools.combinations(fire_engines, 2):
        left = fire_engines[left_key]
        right = fire_engines[right_key]
        assert ImageChops.difference(left, right).getbbox() is not None, f"{left_key}/{right_key}: duplicate drawing"
        assert ImageChops.difference(left.getchannel("A"), right.getchannel("A")).getbbox() is not None, (
            f"{left_key}/{right_key}: palette-only variant"
        )

    if args.proof:
        scale = 6
        panel_width = 30
        row_height = 28
        sheet = Image.new("RGBA", (panel_width * 5 * scale, row_height * len(checked) * scale), (21, 35, 40, 255))
        for row, (_, images) in enumerate(checked):
            panels = [images["horizontal"], images["north"], images["south"], overlay(images["north"], images["south"])]
            for column, image in enumerate(panels):
                x = (column * panel_width + (panel_width - image.width) // 2) * scale
                y = (row * row_height + row_height - image.height - 2) * scale
                sheet.alpha_composite(image.resize((image.width * scale, image.height * scale), Image.Resampling.NEAREST), (x, y))
            # Canonical 8x16 building door: a car must remain below its height.
            draw = ImageDraw.Draw(sheet)
            x0 = (4 * panel_width + 10) * scale
            y0 = (row * row_height + row_height - 18) * scale
            draw.rectangle((x0, y0, x0 + 8 * scale - 1, y0 + 16 * scale - 1), outline=(242, 200, 75, 255), width=scale)
        args.proof.parent.mkdir(parents=True, exist_ok=True)
        sheet.save(args.proof)
    print(json.dumps({"models": len(checked), "views": len(checked) * 3, "fireEngines": len(fire_engines), "valid": True}))


if __name__ == "__main__":
    main()
