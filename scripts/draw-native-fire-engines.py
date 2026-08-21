#!/usr/bin/env python3
"""Render the reviewed 32×8 Tasktopia emergency vehicle family pixel-for-pixel."""

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
    # Stable horizontal frontal-top mass: roof/body, cream service stripe and cab.
    rect(draw, (offset + 2, 1, offset + 26, 1), OUTLINE)
    rect(draw, (offset + 1, 2, offset + 28, 6), OUTLINE)
    rect(draw, (offset + 2, 2, offset + 20, 5), RED)
    rect(draw, (offset + 2, 3, offset + 20, 3), RED_LIGHT)
    rect(draw, (offset + 2, 4, offset + 28, 4), CREAM)
    rect(draw, (offset + 2, 5, offset + 28, 5), RED_DARK)
    # Cab points east and retains a shallow cream roof/top plane.
    rect(draw, (offset + 21, 2, offset + 27, 3), CREAM_LIGHT)
    rect(draw, (offset + 21, 3, offset + 28, 4), CREAM)
    rect(draw, (offset + 22, 2, offset + 24, 3), GLASS)
    rect(draw, (offset + 25, 2, offset + 27, 3), GLASS_DARK)
    draw.point((offset + 29, 4), fill=RED_LIGHT)
    draw.point((offset + 29, 5), fill=AMBER)
    # Two explicit wheels remain readable at native 1x.
    for center in (7, 24):
        rect(draw, (offset + center - 2, 6, offset + center + 2, 6), TIRE)
        rect(draw, (offset + center - 1, 7, offset + center + 1, 7), TIRE)
        draw.point((offset + center, 6), fill=METAL_LIGHT)
    # Roof beacon and rear bumper.
    rect(draw, (offset + 23, 1, offset + 24, 1), OUTLINE)
    draw.point((offset + 23, 1), fill=AMBER)
    draw.point((offset + 1, 5), fill=METAL_LIGHT)


def draw_pumper(draw: ImageDraw.ImageDraw, offset: int) -> None:
    common_engine(draw, offset)
    rect(draw, (offset + 4, 2, offset + 16, 5), METAL_DARK)
    rect(draw, (offset + 5, 2, offset + 15, 4), METAL)
    rect(draw, (offset + 5, 3, offset + 15, 3), METAL_LIGHT)
    rect(draw, (offset + 4, 1, offset + 14, 1), METAL_DARK)
    draw.point((offset + 17, 2), fill=AMBER)


def draw_rescue(draw: ImageDraw.ImageDraw, offset: int) -> None:
    common_engine(draw, offset)
    for left in (4, 9, 14):
        rect(draw, (offset + left, 2, offset + left + 3, 4), METAL_DARK)
        rect(draw, (offset + left + 1, 2, offset + left + 2, 3), METAL_LIGHT)
        draw.point((offset + left + 2, 4), fill=AMBER)
    rect(draw, (offset + 4, 1, offset + 18, 1), METAL)


def draw_ladder(draw: ImageDraw.ImageDraw, offset: int) -> None:
    common_engine(draw, offset)
    rect(draw, (offset + 3, 1, offset + 19, 1), OUTLINE)
    rect(draw, (offset + 4, 1, offset + 18, 1), METAL_LIGHT)
    for x in range(5, 18, 3):
        draw.point((offset + x, 1), fill=OUTLINE)
    rect(draw, (offset + 6, 2, offset + 16, 4), RED_DARK)
    rect(draw, (offset + 8, 2, offset + 18, 2), METAL)
    rect(draw, (offset + 9, 3, offset + 17, 3), METAL_DARK)


def main() -> None:
    image = Image.new("RGBA", (96, 8), TRANSPARENT)
    draw = ImageDraw.Draw(image)
    draw_pumper(draw, 0)
    draw_rescue(draw, 32)
    draw_ladder(draw, 64)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    image.save(OUT, optimize=True)
    print(OUT.resolve())


if __name__ == "__main__":
    main()
