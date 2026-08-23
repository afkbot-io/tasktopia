#!/usr/bin/env python3
"""Render the reviewed 48×16 Tasktopia emergency vehicle family pixel-for-pixel."""

from pathlib import Path

from PIL import Image, ImageDraw


OUT = Path("assets/pixel-city-pack/reference/hand-authored/ambient/fire-engines-v4.png")
TRANSPARENT = (0, 0, 0, 0)
OUTLINE = "#263945"
TIRE = "#182b34"
RED_DARK = "#8f2f32"
RED = "#c64138"
RED_LIGHT = "#e55a45"
CREAM = "#eadfbf"
CREAM_LIGHT = "#f4edda"
GLASS = "#58aec0"
GLASS_DARK = "#326f82"
METAL = "#9ca9aa"
METAL_LIGHT = "#c7ceca"
METAL_DARK = "#68777c"
AMBER = "#e9a13a"


def rect(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], color: str) -> None:
    draw.rectangle(box, fill=color)


def common_engine(draw: ImageDraw.ImageDraw, offset: int) -> None:
    # Two current 24×16 passenger-car lengths, but lower and shorter than the
    # 56×24 bus. Opaque bounds are exactly 46×14 inside the 48×16 canvas.
    rect(draw, (offset + 2, 3, offset + 44, 4), OUTLINE)
    rect(draw, (offset + 1, 5, offset + 46, 12), OUTLINE)
    rect(draw, (offset + 2, 5, offset + 35, 11), RED)
    rect(draw, (offset + 3, 5, offset + 34, 7), RED_LIGHT)
    rect(draw, (offset + 2, 9, offset + 45, 10), CREAM)
    rect(draw, (offset + 2, 11, offset + 45, 12), RED_DARK)
    # The east-facing cab uses the same shallow roof, windscreen and near-side
    # body planes as the current passenger-car family.
    rect(draw, (offset + 35, 3, offset + 43, 4), CREAM_LIGHT)
    rect(draw, (offset + 35, 5, offset + 46, 10), CREAM)
    rect(draw, (offset + 36, 5, offset + 39, 7), GLASS)
    rect(draw, (offset + 40, 5, offset + 43, 7), GLASS_DARK)
    rect(draw, (offset + 44, 7, offset + 46, 10), RED_LIGHT)
    draw.point((offset + 46, 9), fill=AMBER)
    # Two explicit wheels share the sedan baseline and remain inside one lane.
    for center in (10, 39):
        rect(draw, (offset + center - 3, 12, offset + center + 3, 14), TIRE)
        rect(draw, (offset + center - 1, 12, offset + center + 1, 13), METAL_DARK)
        draw.point((offset + center, 12), fill=METAL_LIGHT)
    # Roof beacon and rear bumper.
    rect(draw, (offset + 37, 1, offset + 40, 2), OUTLINE)
    rect(draw, (offset + 38, 1, offset + 39, 1), AMBER)
    rect(draw, (offset + 1, 9, offset + 2, 12), METAL_LIGHT)


def draw_pumper(draw: ImageDraw.ImageDraw, offset: int) -> None:
    common_engine(draw, offset)
    # Auto-pumper: wide ribbed water tank, side pump panel and roof hose tray.
    rect(draw, (offset + 5, 4, offset + 28, 11), METAL_DARK)
    rect(draw, (offset + 6, 4, offset + 27, 8), METAL)
    rect(draw, (offset + 6, 5, offset + 27, 5), METAL_LIGHT)
    for x in (8, 13, 18, 23):
        rect(draw, (offset + x, 7, offset + x + 1, 10), METAL_LIGHT)
    rect(draw, (offset + 29, 6, offset + 33, 10), RED_DARK)
    rect(draw, (offset + 30, 7, offset + 32, 9), METAL_LIGHT)
    draw.point((offset + 31, 8), fill=AMBER)
    rect(draw, (offset + 7, 3, offset + 27, 4), METAL_DARK)


def draw_rescue(draw: ImageDraw.ImageDraw, offset: int) -> None:
    common_engine(draw, offset)
    # Rescue unit: high enclosed equipment body with three unmistakable bays.
    rect(draw, (offset + 4, 3, offset + 32, 11), RED_DARK)
    rect(draw, (offset + 5, 3, offset + 31, 4), CREAM_LIGHT)
    for left in (5, 14, 23):
        rect(draw, (offset + left, 5, offset + left + 7, 10), METAL_DARK)
        rect(draw, (offset + left + 1, 5, offset + left + 6, 8), METAL_LIGHT)
        rect(draw, (offset + left + 3, 9, offset + left + 4, 10), AMBER)
    rect(draw, (offset + 7, 2, offset + 29, 3), METAL)


def draw_ladder(draw: ImageDraw.ImageDraw, offset: int) -> None:
    common_engine(draw, offset)
    # Ladder truck: open turntable and a long ladder reaching almost the cab.
    rect(draw, (offset + 3, 1, offset + 33, 4), OUTLINE)
    rect(draw, (offset + 4, 1, offset + 32, 1), METAL_LIGHT)
    rect(draw, (offset + 4, 4, offset + 32, 4), METAL)
    for x in range(6, 33, 4):
        rect(draw, (offset + x, 1, offset + x, 4), OUTLINE)
    rect(draw, (offset + 7, 5, offset + 29, 10), RED_DARK)
    rect(draw, (offset + 12, 6, offset + 31, 7), METAL)
    rect(draw, (offset + 13, 8, offset + 28, 9), METAL_DARK)


def main() -> None:
    image = Image.new("RGBA", (144, 16), TRANSPARENT)
    draw = ImageDraw.Draw(image)
    draw_pumper(draw, 0)
    draw_rescue(draw, 48)
    draw_ladder(draw, 96)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    image.save(OUT, optimize=True)
    print(OUT.resolve())


if __name__ == "__main__":
    main()
