#!/usr/bin/env python3
"""Render the reviewed 48×16 Tasktopia emergency vehicle family pixel-for-pixel."""

from pathlib import Path

from PIL import Image, ImageDraw


OUT = Path("assets/pixel-city-pack/reference/hand-authored/ambient/fire-engines-v5.png")
TRANSPARENT = (0, 0, 0, 0)
OUTLINE = "#263945"
TIRE = "#182b34"
RED_SHADOW = "#7f2930"
RED_DARK = "#9e3034"
RED = "#c64138"
RED_LIGHT = "#e15b49"
CREAM = "#ddd6bd"
CREAM_LIGHT = "#f1ead7"
GLASS = "#58aec0"
GLASS_LIGHT = "#75c3ce"
GLASS_DARK = "#2f6878"
METAL = "#96a5a8"
METAL_LIGHT = "#c5ceca"
METAL_DARK = "#68777c"
AMBER = "#e9a13a"


def rect(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], color: str) -> None:
    draw.rectangle(box, fill=color)


def poly(draw: ImageDraw.ImageDraw, offset: int, points: list[tuple[int, int]], color: str) -> None:
    draw.polygon([(offset + x, y) for x, y in points], fill=color)


def draw_wheel(draw: ImageDraw.ImageDraw, offset: int, center: int) -> None:
    # Four authored rows form a rounded tyre. The 3 px ground contact prevents
    # the old square caster look while keeping one hard-pixel component.
    poly(draw, offset, [
        (center - 3, 12), (center + 3, 12),
        (center + 4, 13), (center + 3, 14),
        (center + 1, 15), (center - 1, 15),
        (center - 3, 14), (center - 4, 13),
    ], TIRE)
    rect(draw, (offset + center - 2, 13, offset + center + 2, 14), METAL_DARK)
    rect(draw, (offset + center - 1, 13, offset + center + 1, 14), METAL_LIGHT)
    draw.point((offset + center, 14), fill=OUTLINE)


def common_chassis_and_cab(draw: ImageDraw.ImageDraw, offset: int) -> None:
    # Thin chassis and near-side body plane; only two rows span most of the
    # vehicle, unlike the former rectangular block.
    poly(draw, offset, [
        (1, 9), (3, 8), (31, 8), (33, 9), (46, 9),
        (46, 12), (44, 13), (42, 13), (41, 12),
        (35, 12), (34, 13), (14, 13), (13, 12),
        (7, 12), (6, 13), (3, 13), (1, 11),
    ], OUTLINE)
    poly(draw, offset, [
        (2, 9), (31, 9), (33, 10), (45, 10),
        (45, 11), (43, 12), (3, 12), (2, 11),
    ], RED_DARK)
    rect(draw, (offset + 3, 9, offset + 43, 9), CREAM)
    rect(draw, (offset + 15, 12, offset + 33, 12), RED_SHADOW)

    # East-facing cab: a stepped roof, two windows, sloped windscreen and hood
    # expose the same shallow frontal-top camera as the passenger-car family.
    poly(draw, offset, [
        (31, 7), (32, 5), (34, 3), (40, 3), (42, 4),
        (43, 6), (45, 7), (46, 9), (46, 11), (44, 12),
        (32, 12), (31, 10),
    ], OUTLINE)
    poly(draw, offset, [
        (32, 7), (33, 5), (35, 4), (39, 4), (41, 5),
        (42, 7), (44, 8), (45, 9), (45, 11), (43, 11),
        (32, 11),
    ], RED)
    # Roof/top plane and upper-left highlight.
    poly(draw, offset, [(34, 3), (40, 3), (41, 4), (35, 4)], CREAM_LIGHT)
    rect(draw, (offset + 35, 4, offset + 40, 4), CREAM)
    # Near-side window and the independently sloped front windscreen.
    poly(draw, offset, [(34, 5), (38, 5), (38, 8), (33, 8), (33, 6)], GLASS)
    rect(draw, (offset + 34, 5, offset + 37, 5), GLASS_LIGHT)
    poly(draw, offset, [(39, 5), (41, 5), (42, 7), (42, 8), (39, 8)], GLASS_DARK)
    draw.point((offset + 40, 5), fill=GLASS_LIGHT)
    rect(draw, (offset + 33, 9, offset + 42, 10), RED_LIGHT)
    rect(draw, (offset + 38, 9, offset + 38, 11), OUTLINE)
    draw.point((offset + 40, 10), fill=AMBER)
    # Hood/front face taper rather than a vertical rectangular cab end.
    poly(draw, offset, [(43, 8), (45, 9), (45, 11), (43, 11)], RED_LIGHT)
    rect(draw, (offset + 44, 11, offset + 46, 12), CREAM)
    draw.point((offset + 46, 10), fill=AMBER)
    draw.point((offset + 45, 12), fill=OUTLINE)

    # Low beacon belongs to the cab roof and establishes the 14 px envelope.
    rect(draw, (offset + 36, 2, offset + 39, 2), OUTLINE)
    rect(draw, (offset + 37, 2, offset + 38, 2), AMBER)
    draw_wheel(draw, offset, 10)
    draw_wheel(draw, offset, 38)


def draw_pumper(draw: ImageDraw.ImageDraw, offset: int) -> None:
    common_chassis_and_cab(draw, offset)
    # Rounded tank: narrow top plane, curved end pixels, ribbed near side and a
    # separate pump panel. It reads as volume, not as a warehouse rectangle.
    poly(draw, offset, [
        (1, 8), (2, 6), (4, 4), (26, 4), (29, 5),
        (31, 7), (31, 10), (29, 11), (3, 11), (1, 10),
    ], OUTLINE)
    poly(draw, offset, [
        (3, 6), (5, 5), (25, 5), (28, 6), (29, 7),
        (29, 10), (3, 10), (2, 9),
    ], METAL)
    poly(draw, offset, [(5, 4), (25, 4), (27, 5), (4, 5)], METAL_LIGHT)
    rect(draw, (offset + 3, 8, offset + 29, 10), METAL_DARK)
    for x in (7, 12, 17, 22):
        rect(draw, (offset + x, 6, offset + x, 9), METAL_LIGHT)
    rect(draw, (offset + 26, 7, offset + 30, 10), RED_DARK)
    rect(draw, (offset + 27, 8, offset + 29, 9), METAL_LIGHT)
    draw.point((offset + 28, 9), fill=AMBER)


def draw_rescue(draw: ImageDraw.ImageDraw, offset: int) -> None:
    common_chassis_and_cab(draw, offset)
    # A chamfered high rescue body with a visible pale roof plane and three
    # roll-up equipment bays. Corners step inward instead of forming a box.
    poly(draw, offset, [
        (1, 8), (2, 6), (5, 3), (26, 3), (29, 4),
        (31, 6), (31, 11), (29, 12), (3, 12), (1, 10),
    ], OUTLINE)
    poly(draw, offset, [(5, 3), (26, 3), (28, 4), (3, 4)], CREAM_LIGHT)
    poly(draw, offset, [
        (3, 6), (5, 5), (28, 5), (30, 7), (30, 10),
        (28, 11), (3, 11), (2, 9),
    ], RED_DARK)
    for left, width in ((4, 7), (13, 7), (22, 6)):
        rect(draw, (offset + left, 6, offset + left + width, 10), METAL_DARK)
        rect(draw, (offset + left + 1, 6, offset + left + width - 1, 8), METAL_LIGHT)
        rect(draw, (offset + left + 1, 9, offset + left + width - 1, 9), METAL)
        draw.point((offset + left + width - 1, 10), fill=AMBER)


def draw_ladder(draw: ImageDraw.ImageDraw, offset: int) -> None:
    common_chassis_and_cab(draw, offset)
    # Lower open bed and a slightly rising authored ladder. The turntable joins
    # roof equipment to the chassis so the whole truck remains one silhouette.
    poly(draw, offset, [
        (1, 8), (3, 6), (27, 6), (31, 8), (31, 11),
        (29, 12), (3, 12), (1, 10),
    ], OUTLINE)
    poly(draw, offset, [(3, 7), (26, 7), (29, 8), (29, 11), (3, 11), (2, 9)], RED)
    rect(draw, (offset + 4, 8, offset + 28, 9), RED_LIGHT)
    rect(draw, (offset + 18, 5, offset + 24, 8), OUTLINE)
    rect(draw, (offset + 19, 5, offset + 23, 7), METAL_DARK)
    # Ladder rails rise by one pixel toward the cab, matching the near-top view.
    poly(draw, offset, [(4, 3), (29, 2), (30, 3), (5, 4)], OUTLINE)
    poly(draw, offset, [(5, 3), (28, 2), (29, 2), (6, 3)], METAL_LIGHT)
    poly(draw, offset, [(5, 5), (29, 4), (30, 5), (6, 6)], OUTLINE)
    poly(draw, offset, [(6, 5), (28, 4), (29, 4), (7, 5)], METAL)
    for x in range(8, 29, 4):
        draw.line((offset + x, 3, offset + x + 1, 5), fill=OUTLINE)


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
