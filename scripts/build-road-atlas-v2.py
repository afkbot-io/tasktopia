#!/usr/bin/env python3
"""Build deterministic mask-driven Tasktopia road and footway atlases."""

from pathlib import Path
from PIL import Image, ImageColor, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "game-assets" / "v5" / "atlas" / "road-v2"
REVIEW = ROOT / "screenshots" / "road-atlas-v2-contact-sheet.png"
CELL = 8
MASKS = range(16)
VARIANTS = range(3)

ROAD_FAMILIES = (
    ("LOCAL", "#3d4856", "#263540", "#53606d", "#758087"),
    ("COLLECTOR", "#394754", "#243440", "#4d5c68", "#707d84"),
    ("ARTERIAL", "#35434f", "#22313d", "#495864", "#6b7880"),
    ("HIGHWAY", "#303e4b", "#1d2c37", "#44535f", "#65727a"),
    ("BRIDGE", "#3b4853", "#22313b", "#53636b", "#91a19f"),
)

SURFACE_FAMILIES = (
    ("PAVEMENT", "#849195", "#58676e", "#95a0a1", "#707d82"),
    ("PATH_EARTH", "#8d7152", "#735b44", "#a58965", "#654f3c"),
    ("PATH_PAVERS", "#808d89", "#5f6d6b", "#96a19c", "#6b7774"),
    ("PATH_ASPHALT", "#5c676d", "#3f4b52", "#758084", "#4b565c"),
    ("DRIVEWAY", "#3d4856", "#263540", "#53606d", "#313d49"),
)


def stable(seed: str) -> int:
    value = 2166136261
    for byte in seed.encode():
        value ^= byte
        value = value * 16777619 & 0xFFFFFFFF
    return value


def directional_material(
    family: str,
    mask: int,
    variant: int,
    base: str,
    edge: str,
    light: str,
    detail: str,
) -> Image.Image:
    # Terrain V4 never cuts transparent holes into a terrain cell. Roads use
    # the same grammar: an opaque edge field, a compact centre and cardinal
    # arms selected by the NESW mask. Corners stay deliberately blocky.
    image = Image.new("RGBA", (CELL, CELL), edge)
    draw = ImageDraw.Draw(image)
    draw.rectangle((2, 2, 5, 5), fill=base)
    if mask & 1: draw.rectangle((2, 0, 5, 2), fill=base)
    if mask & 2: draw.rectangle((5, 2, 7, 5), fill=base)
    if mask & 4: draw.rectangle((2, 5, 5, 7), fill=base)
    if mask & 8: draw.rectangle((0, 2, 2, 5), fill=base)

    # A one-pixel, stepped upper-left highlight and lower-right shade replaces
    # the old continuous rounded bevel. It matches grass/coast/water clusters.
    if not mask & 1:
        draw.line((2, 2, 5, 2), fill=light)
    if not mask & 8:
        draw.line((2, 2, 2, 5), fill=light)
    if not mask & 2:
        draw.line((5, 2, 5, 5), fill=detail)
    if not mask & 4:
        draw.line((2, 5, 5, 5), fill=detail)

    seed = stable(f"{family}:{mask}:{variant}")
    candidates = ((2, 2), (5, 1), (3, 5), (6, 6), (1, 4), (5, 4))
    first = seed % len(candidates)
    second = (seed >> 5) % len(candidates)
    for index, point in enumerate((candidates[first], candidates[second])):
        if index == 1 and (variant == 0 or second == first):
            continue
        if image.getpixel(point)[:3] == ImageColor.getrgb(base):
            draw.point(point, fill=light if variant == 2 and index == 0 else detail)

    if family == "PAVEMENT":
        # Quiet slab joints, aligned to the same top-left light as terrain V4.
        draw.point((1, 1), fill=light)
        draw.point((6, 6), fill=edge)
    elif family == "PATH_PAVERS":
        draw.line((2, 3, 5, 3), fill=detail)
        draw.point((2, 4), fill=light)
    elif family == "BRIDGE":
        draw.point((1, 1), fill=light)
        draw.point((6, 6), fill=edge)
    return image


def build_directional_sheet(families, target: Path) -> None:
    sheet = Image.new("RGBA", (CELL * 16, CELL * len(families) * 3), (0, 0, 0, 0))
    for family_index, palette in enumerate(families):
        family, base, edge, light, detail = palette
        for variant in VARIANTS:
            for mask in MASKS:
                tile = directional_material(family, mask, variant, base, edge, light, detail)
                sheet.alpha_composite(tile, (mask * CELL, (family_index * 3 + variant) * CELL))
    target.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(target, optimize=True)


def overlay_tile(kind: str) -> Image.Image:
    image = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    paint, shade = "#d6d7cf", "#aeb5b1"
    if kind == "CROSSWALK_H":
        for x in (0, 3, 6):
            draw.rectangle((x, 0, min(7, x + 1), 7), fill=paint)
            draw.point((x, 7), fill=shade)
    elif kind == "CROSSWALK_V":
        for y in (0, 3, 6):
            draw.rectangle((0, y, 7, min(7, y + 1)), fill=paint)
            draw.point((7, y), fill=shade)
    elif kind == "MARKING_H":
        draw.line((1, 3, 6, 3), fill="#d6bd6c")
    elif kind == "MARKING_V":
        draw.line((3, 1, 3, 6), fill="#d6bd6c")
    elif kind.startswith("BRIDGE_RAIL_"):
        direction = kind[-1]
        if direction == "N":
            draw.line((0, 1, 7, 1), fill="#a8b8b4")
            draw.line((0, 2, 7, 2), fill="#526a71")
            for x in (0, 4, 7): draw.point((x, 0), fill="#263945")
        elif direction == "E":
            draw.line((6, 0, 6, 7), fill="#a8b8b4")
            draw.line((5, 0, 5, 7), fill="#526a71")
            for y in (0, 4, 7): draw.point((7, y), fill="#263945")
        elif direction == "S":
            draw.line((0, 6, 7, 6), fill="#a8b8b4")
            draw.line((0, 5, 7, 5), fill="#526a71")
            for x in (0, 4, 7): draw.point((x, 7), fill="#263945")
        else:
            draw.line((1, 0, 1, 7), fill="#a8b8b4")
            draw.line((2, 0, 2, 7), fill="#526a71")
            for y in (0, 4, 7): draw.point((0, y), fill="#263945")
    elif kind.startswith("BRIDGE_PORTAL_"):
        direction = kind[-1]
        if direction == "N": draw.rectangle((1, 0, 6, 1), fill="#b7c4c2")
        elif direction == "E": draw.rectangle((6, 1, 7, 6), fill="#b7c4c2")
        elif direction == "S": draw.rectangle((1, 6, 6, 7), fill="#b7c4c2")
        else: draw.rectangle((0, 1, 1, 6), fill="#b7c4c2")
    return image


def build_overlay_sheet() -> None:
    kinds = (
        "CROSSWALK_H", "CROSSWALK_V", "MARKING_H", "MARKING_V",
        "BRIDGE_RAIL_N", "BRIDGE_RAIL_E", "BRIDGE_RAIL_S", "BRIDGE_RAIL_W",
        "BRIDGE_PORTAL_N", "BRIDGE_PORTAL_E", "BRIDGE_PORTAL_S", "BRIDGE_PORTAL_W",
    )
    sheet = Image.new("RGBA", (CELL * len(kinds), CELL), (0, 0, 0, 0))
    for index, kind in enumerate(kinds):
        sheet.alpha_composite(overlay_tile(kind), (index * CELL, 0))
    sheet.save(OUTPUT / "overlay.png", optimize=True)


def build_review() -> None:
    road = Image.open(OUTPUT / "road.png").convert("RGBA")
    surface = Image.open(OUTPUT / "surface.png").convert("RGBA")
    overlay = Image.open(OUTPUT / "overlay.png").convert("RGBA")
    scale = 4
    margin = 12
    image = Image.new("RGBA", (16 * CELL * scale + margin * 2, 176), "#102126")
    image.alpha_composite(road.crop((0, 0, 16 * CELL, 3 * CELL)).resize((16 * CELL * scale, 3 * CELL * scale), Image.Resampling.NEAREST), (margin, 8))
    image.alpha_composite(surface.crop((0, 0, 16 * CELL, 3 * CELL)).resize((16 * CELL * scale, 3 * CELL * scale), Image.Resampling.NEAREST), (margin, 8 + 3 * CELL * scale + 8))
    image.alpha_composite(overlay.resize((overlay.width * scale, overlay.height * scale), Image.Resampling.NEAREST), (margin, 144))
    REVIEW.parent.mkdir(parents=True, exist_ok=True)
    image.save(REVIEW, optimize=True)


def main() -> None:
    build_directional_sheet(ROAD_FAMILIES, OUTPUT / "road.png")
    build_directional_sheet(SURFACE_FAMILIES, OUTPUT / "surface.png")
    build_overlay_sheet()
    build_review()
    print("road atlas v2: 5 road families, 5 surface families and 12 overlays built")


if __name__ == "__main__":
    main()
