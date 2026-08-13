#!/usr/bin/env python3
"""Render a grid-exact building scale preview without touching game runtime."""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
CELL_SIZE = 8
SITE_COLUMNS = 20
SITE_ROWS = 30
BUILDING_WIDTH_CELLS = 18
BUILDING_DEPTH_CELLS = 16
BUILDING_HEIGHT_CELLS = 35
BUILDING_ORIGIN_X = (SITE_COLUMNS - BUILDING_WIDTH_CELLS) // 2
BUILDING_ORIGIN_Y = (SITE_ROWS - BUILDING_DEPTH_CELLS) // 2
PAVEMENT = ROOT / "assets/pixel-city-pack/runtime/tiles/pavement.png"
PAVEMENT_MODES = ("reference-grid", "runtime")

# The reference sidewalk is still orthogonal to the map. Its apparent viewing
# angle comes from the bevel on every slab: light reaches the top/left edges,
# while the bottom/right edges fall into shadow. Keeping this as an explicit
# 8x8 matrix makes the seam and lighting contract reviewable pixel by pixel.
REFERENCE_PAVEMENT_PALETTE = {
    "J": (88, 103, 110, 255),    # narrow recessed joint
    "S": (120, 134, 140, 255),   # rare lower-right shadow cluster
    "B": (132, 145, 149, 255),   # slab face
    "A": (136, 149, 153, 255),   # quiet aggregate variation
    "L": (143, 155, 158, 255),   # soft upper-left light
    "H": (149, 160, 161, 255),   # rare stone highlight
}
REFERENCE_PAVEMENT_VARIANTS = (
    (
        "JJJJJJJJ",
        "JLLLLLLL",
        "JLABBBBB",
        "JLBBBBAB",
        "JABBBBBB",
        "JLABBBBB",
        "JABBABBB",
        "JBBBBBSS",
    ),
    (
        "JJJJJJJJ",
        "JLLLLLLL",
        "JLBBBBBB",
        "JABBBABB",
        "JLBBBBBB",
        "JLABBBBB",
        "JBBHBBBB",
        "JBBBBBBS",
    ),
    (
        "JJJJJJJJ",
        "JLLLLLLL",
        "JLABBBBB",
        "JLBBBBBB",
        "JABBBBBB",
        "JLBBHBBB",
        "JBBBBABB",
        "JBBBBBSS",
    ),
    (
        "JJJJJJJJ",
        "JLLLLLLL",
        "JLBBBBBB",
        "JLABBBBB",
        "JABBBBBB",
        "JLBBBABB",
        "JABBBBBB",
        "JBBBBBBS",
    ),
    (
        "JJJJJJJJ",
        "JLLLLLLL",
        "JLABBABB",
        "JLBBBBBB",
        "JABHBBBB",
        "JLBBBBBB",
        "JABBBBBB",
        "JBBBBBSS",
    ),
)


@dataclass(frozen=True)
class Point:
    x: int
    y: int


def layout_contract() -> dict[str, object]:
    site_width = SITE_COLUMNS * CELL_SIZE
    site_height = SITE_ROWS * CELL_SIZE
    sprite_width = BUILDING_WIDTH_CELLS * CELL_SIZE
    sprite_height = BUILDING_HEIGHT_CELLS * CELL_SIZE
    anchor = Point(
        x=(BUILDING_ORIGIN_X * CELL_SIZE) + sprite_width // 2,
        y=(BUILDING_ORIGIN_Y + BUILDING_DEPTH_CELLS) * CELL_SIZE,
    )
    platform_offset_y = max(0, sprite_height - anchor.y)
    return {
        "cellSize": CELL_SIZE,
        "site": {
            "columns": SITE_COLUMNS,
            "rows": SITE_ROWS,
            "widthPx": site_width,
            "heightPx": site_height,
        },
        "building": {
            "widthCells": BUILDING_WIDTH_CELLS,
            "depthCells": BUILDING_DEPTH_CELLS,
            "heightCells": BUILDING_HEIGHT_CELLS,
            "origin": asdict(Point(BUILDING_ORIGIN_X, BUILDING_ORIGIN_Y)),
            "anchorPx": asdict(anchor),
            "spriteSizePx": {"width": sprite_width, "height": sprite_height},
        },
        "canvas": {
            "widthPx": site_width,
            "heightPx": site_height + platform_offset_y,
            "platformOffsetYPx": platform_offset_y,
        },
    }


def remove_magenta(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    pixels = rgba.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            red, green, blue, alpha = pixels[x, y]
            if alpha == 0:
                # Runtime sprites are already transparent. Preserve their
                # empty authoring canvas instead of hardening RGB(0,0,0,0)
                # into an opaque black rectangle.
                continue
            # Generated chroma sources contain a thin antialiased pink fringe,
            # not only pure #ff00ff. Remove every pixel where red and blue are
            # jointly dominant; the building palette never uses that hue.
            if red >= 100 and blue >= 100 and min(red, blue) >= green + 40:
                pixels[x, y] = (red, green, blue, 0)
            elif alpha != 255:
                pixels[x, y] = (red, green, blue, 255)
    bounds = rgba.getchannel("A").getbbox()
    if bounds is None:
        raise ValueError("building source became empty after chroma removal")
    return rgba.crop(bounds)


def normalize_building(source: Path, width: int, height: int) -> Image.Image:
    image = remove_magenta(Image.open(source))
    scale = min(width / image.width, height / image.height)
    resized = image.resize(
        (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
        Image.Resampling.NEAREST,
    )
    sprite = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    sprite.alpha_composite(resized, ((width - resized.width) // 2, height - resized.height))
    return sprite


def pavement_contract() -> dict[str, object]:
    return {
        "tileSizePx": {"width": CELL_SIZE, "height": CELL_SIZE},
        "variantCount": len(REFERENCE_PAVEMENT_VARIANTS),
        "paletteColorCount": len(REFERENCE_PAVEMENT_PALETTE),
        "projection": "orthogonal-frontal-top",
        "lightDirection": "upper-left",
        "seams": "single shared one-pixel top-and-left joint",
    }


def reference_pavement_tile(variant_index: int = 0) -> Image.Image:
    matrix = REFERENCE_PAVEMENT_VARIANTS[variant_index % len(REFERENCE_PAVEMENT_VARIANTS)]
    if len(matrix) != CELL_SIZE or any(
        len(row) != CELL_SIZE for row in matrix
    ):
        raise ValueError("reference pavement matrix must be exactly 8x8")
    pavement = Image.new("RGBA", (CELL_SIZE, CELL_SIZE), (0, 0, 0, 0))
    pixels = pavement.load()
    for y, row in enumerate(matrix):
        for x, key in enumerate(row):
            pixels[x, y] = REFERENCE_PAVEMENT_PALETTE[key]
    if pavement.getchannel("A").getextrema() != (255, 255):
        raise ValueError("reference pavement must be fully opaque")
    return pavement


def pavement_tile(mode: str, variant_index: int = 0) -> Image.Image:
    if mode == "reference-grid":
        return reference_pavement_tile(variant_index)
    if mode == "runtime":
        return Image.open(PAVEMENT).convert("RGBA")
    raise ValueError(f"unknown pavement mode: {mode}")


def pavement_variant_index(column: int, row: int) -> int:
    # A deterministic spatial hash avoids a diagonal/wallpaper repeat while
    # keeping rerenders stable for visual comparison.
    return ((column * 37) ^ (row * 53) ^ (column * row * 11)) % len(REFERENCE_PAVEMENT_VARIANTS)


def tiled_platform(mode: str, columns: int = SITE_COLUMNS, rows: int = SITE_ROWS) -> Image.Image:
    platform = Image.new("RGBA", (SITE_COLUMNS * CELL_SIZE, SITE_ROWS * CELL_SIZE), (0, 0, 0, 0))
    if columns != SITE_COLUMNS or rows != SITE_ROWS:
        platform = Image.new("RGBA", (columns * CELL_SIZE, rows * CELL_SIZE), (0, 0, 0, 0))
    for row in range(rows):
        for column in range(columns):
            variant_index = pavement_variant_index(column, row) if mode == "reference-grid" else 0
            pavement = pavement_tile(mode, variant_index)
            if pavement.size != (CELL_SIZE, CELL_SIZE):
                raise ValueError(f"pavement tile must be 8x8, got {pavement.size}")
            platform.alpha_composite(pavement, (column * CELL_SIZE, row * CELL_SIZE))
    return platform


def render_pavement_samples(output: Path, preview_output: Path, mode: str) -> None:
    pavement = tiled_platform(mode, columns=5, rows=5)
    output.parent.mkdir(parents=True, exist_ok=True)
    preview_output.parent.mkdir(parents=True, exist_ok=True)
    pavement.save(output, optimize=True)
    pavement.resize((240, 240), Image.Resampling.NEAREST).save(preview_output, optimize=True)


def render_layout_debug(output: Path, preview_output: Path, preview_scale: int, pavement_mode: str) -> None:
    layout = tiled_platform(pavement_mode)
    tint = Image.new("RGBA", layout.size, (0, 0, 0, 0))
    tint_draw = ImageDraw.Draw(tint)
    left = BUILDING_ORIGIN_X * CELL_SIZE
    top = BUILDING_ORIGIN_Y * CELL_SIZE
    right = left + BUILDING_WIDTH_CELLS * CELL_SIZE - 1
    bottom = top + BUILDING_DEPTH_CELLS * CELL_SIZE - 1
    tint_draw.rectangle((left, top, right, bottom), fill=(58, 166, 190, 72))
    layout.alpha_composite(tint)

    draw = ImageDraw.Draw(layout)
    for column in range(SITE_COLUMNS + 1):
        x = min(layout.width - 1, column * CELL_SIZE)
        draw.line((x, 0, x, layout.height - 1), fill=(38, 57, 69, 255), width=1)
    for row in range(SITE_ROWS + 1):
        y = min(layout.height - 1, row * CELL_SIZE)
        draw.line((0, y, layout.width - 1, y), fill=(38, 57, 69, 255), width=1)
    draw.rectangle((left, top, right, bottom), outline=(242, 200, 75, 255), width=1)
    anchor_x = (BUILDING_ORIGIN_X * CELL_SIZE) + BUILDING_WIDTH_CELLS * CELL_SIZE // 2
    anchor_y = (BUILDING_ORIGIN_Y + BUILDING_DEPTH_CELLS) * CELL_SIZE
    draw.line((anchor_x - 3, anchor_y, anchor_x + 3, anchor_y), fill=(220, 72, 72, 255), width=1)
    draw.line((anchor_x, anchor_y - 3, anchor_x, anchor_y + 3), fill=(220, 72, 72, 255), width=1)

    output.parent.mkdir(parents=True, exist_ok=True)
    preview_output.parent.mkdir(parents=True, exist_ok=True)
    layout.save(output, optimize=True)
    layout.resize((layout.width * preview_scale, layout.height * preview_scale), Image.Resampling.NEAREST).save(preview_output, optimize=True)


def render(
    building_source: Path,
    output: Path,
    preview_output: Path,
    layout_output: Path,
    layout_preview_output: Path,
    pavement_output: Path,
    pavement_preview_output: Path,
    preview_scale: int,
    pavement_mode: str,
) -> dict[str, object]:
    contract = layout_contract()
    site = contract["site"]
    building = contract["building"]
    canvas_info = contract["canvas"]
    assert isinstance(site, dict) and isinstance(building, dict) and isinstance(canvas_info, dict)

    canvas = Image.new(
        "RGBA",
        (int(canvas_info["widthPx"]), int(canvas_info["heightPx"])),
        (102, 133, 72, 255),
    )
    platform_offset_y = int(canvas_info["platformOffsetYPx"])
    canvas.alpha_composite(tiled_platform(pavement_mode), (0, platform_offset_y))

    sprite_size = building["spriteSizePx"]
    anchor = building["anchorPx"]
    assert isinstance(sprite_size, dict) and isinstance(anchor, dict)
    sprite = normalize_building(building_source, int(sprite_size["width"]), int(sprite_size["height"]))
    sprite_x = int(anchor["x"]) - sprite.width // 2
    sprite_y = platform_offset_y + int(anchor["y"]) - sprite.height
    canvas.alpha_composite(sprite, (sprite_x, sprite_y))

    output.parent.mkdir(parents=True, exist_ok=True)
    preview_output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output, optimize=True)
    canvas.resize(
        (canvas.width * preview_scale, canvas.height * preview_scale),
        Image.Resampling.NEAREST,
    ).save(preview_output, optimize=True)
    render_layout_debug(layout_output, layout_preview_output, preview_scale, pavement_mode)
    render_pavement_samples(pavement_output, pavement_preview_output, pavement_mode)
    return {
        **contract,
        "output": str(output),
        "previewOutput": str(preview_output),
        "layoutOutput": str(layout_output),
        "layoutPreviewOutput": str(layout_preview_output),
        "pavementOutput": str(pavement_output),
        "pavementPreviewOutput": str(pavement_preview_output),
        "pavementMode": pavement_mode,
        "previewScale": preview_scale,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--building", type=Path, help="completed building image (PNG; magenta or alpha background)")
    parser.add_argument("--output", type=Path, default=ROOT / "tmp/building-grid-preview.png")
    parser.add_argument("--preview-output", type=Path, default=ROOT / "tmp/building-grid-preview-4x.png")
    parser.add_argument("--layout-output", type=Path, default=ROOT / "tmp/building-grid-layout.png")
    parser.add_argument("--layout-preview-output", type=Path, default=ROOT / "tmp/building-grid-layout-4x.png")
    parser.add_argument("--pavement-output", type=Path, default=ROOT / "tmp/pavement-grid-swatch.png")
    parser.add_argument("--pavement-preview-output", type=Path, default=ROOT / "tmp/pavement-grid-swatch-6x.png")
    parser.add_argument("--pavement-mode", choices=PAVEMENT_MODES, default="reference-grid")
    parser.add_argument("--preview-scale", type=int, default=4)
    parser.add_argument("--describe-layout", action="store_true")
    parser.add_argument("--describe-pavement", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.describe_layout:
        print(json.dumps(layout_contract(), ensure_ascii=False))
        return
    if args.describe_pavement:
        print(json.dumps(pavement_contract(), ensure_ascii=False))
        return
    if args.building is None:
        raise SystemExit("--building is required unless a --describe-* option is used")
    if args.preview_scale < 1:
        raise SystemExit("--preview-scale must be at least 1")
    print(json.dumps(render(
        args.building,
        args.output,
        args.preview_output,
        args.layout_output,
        args.layout_preview_output,
        args.pavement_output,
        args.pavement_preview_output,
        args.preview_scale,
        args.pavement_mode,
    ), ensure_ascii=False))


if __name__ == "__main__":
    main()
