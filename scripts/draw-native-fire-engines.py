#!/usr/bin/env python3
"""Render the reviewed 40×16 Tasktopia emergency vehicle family pixel-for-pixel."""

from pathlib import Path

from PIL import Image, ImageDraw


OUT = Path("assets/pixel-city-pack/reference/hand-authored/ambient/fire-engines-v3.png")
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
    # A full-height emergency chassis: roughly 2.5 cars long and clearly
    # taller than an ordinary sedan without becoming bus-sized.
    rect(draw, (offset + 2, 3, offset + 36, 4), OUTLINE)
    rect(draw, (offset + 1, 5, offset + 38, 13), OUTLINE)
    rect(draw, (offset + 2, 5, offset + 28, 12), RED)
    rect(draw, (offset + 3, 5, offset + 27, 7), RED_LIGHT)
    rect(draw, (offset + 2, 9, offset + 37, 10), CREAM)
    rect(draw, (offset + 2, 11, offset + 37, 12), RED_DARK)
    # Cab points east and exposes the same shallow frontal-top plane as cars.
    rect(draw, (offset + 28, 4, offset + 36, 5), CREAM_LIGHT)
    rect(draw, (offset + 28, 5, offset + 38, 10), CREAM)
    rect(draw, (offset + 29, 5, offset + 32, 8), GLASS)
    rect(draw, (offset + 33, 5, offset + 36, 8), GLASS_DARK)
    rect(draw, (offset + 37, 7, offset + 38, 10), RED_LIGHT)
    draw.point((offset + 38, 9), fill=AMBER)
    # Two explicit 5×3 wheels remain readable at native 1x.
    for center in (9, 31):
        rect(draw, (offset + center - 3, 12, offset + center + 3, 14), TIRE)
        rect(draw, (offset + center - 2, 14, offset + center + 2, 15), TIRE)
        rect(draw, (offset + center - 1, 13, offset + center + 1, 14), METAL_DARK)
        draw.point((offset + center, 13), fill=METAL_LIGHT)
    # Roof beacon and rear bumper.
    rect(draw, (offset + 30, 2, offset + 33, 3), OUTLINE)
    rect(draw, (offset + 31, 2, offset + 32, 2), AMBER)
    rect(draw, (offset + 1, 10, offset + 2, 12), METAL_LIGHT)


def draw_pumper(draw: ImageDraw.ImageDraw, offset: int) -> None:
    common_engine(draw, offset)
    rect(draw, (offset + 5, 5, offset + 23, 11), METAL_DARK)
    rect(draw, (offset + 6, 5, offset + 22, 9), METAL)
    rect(draw, (offset + 6, 6, offset + 22, 6), METAL_LIGHT)
    for x in (8, 12, 16, 20):
        rect(draw, (offset + x, 8, offset + x + 1, 10), METAL_LIGHT)
    rect(draw, (offset + 6, 3, offset + 21, 4), METAL_DARK)
    draw.point((offset + 24, 6), fill=AMBER)


def draw_rescue(draw: ImageDraw.ImageDraw, offset: int) -> None:
    common_engine(draw, offset)
    for left in (5, 12, 19):
        rect(draw, (offset + left, 5, offset + left + 5, 10), METAL_DARK)
        rect(draw, (offset + left + 1, 5, offset + left + 4, 8), METAL_LIGHT)
        rect(draw, (offset + left + 2, 9, offset + left + 3, 10), AMBER)
    rect(draw, (offset + 5, 3, offset + 25, 4), METAL)


def draw_ladder(draw: ImageDraw.ImageDraw, offset: int) -> None:
    common_engine(draw, offset)
    rect(draw, (offset + 4, 2, offset + 26, 4), OUTLINE)
    rect(draw, (offset + 5, 2, offset + 25, 2), METAL_LIGHT)
    rect(draw, (offset + 5, 4, offset + 25, 4), METAL)
    for x in range(7, 25, 4):
        rect(draw, (offset + x, 2, offset + x, 4), OUTLINE)
    rect(draw, (offset + 7, 5, offset + 23, 10), RED_DARK)
    rect(draw, (offset + 10, 6, offset + 24, 7), METAL)
    rect(draw, (offset + 11, 8, offset + 22, 9), METAL_DARK)


def main() -> None:
    image = Image.new("RGBA", (120, 16), TRANSPARENT)
    draw = ImageDraw.Draw(image)
    draw_pumper(draw, 0)
    draw_rescue(draw, 40)
    draw_ladder(draw, 80)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    image.save(OUT, optimize=True)
    print(OUT.resolve())


if __name__ == "__main__":
    main()
