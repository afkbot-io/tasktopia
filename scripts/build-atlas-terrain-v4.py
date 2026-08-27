#!/usr/bin/env python3
"""Build deterministic directional Tasktopia atlas terrain sprite sheets."""

from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "game-assets" / "v5" / "atlas" / "terrain-v4"
REVIEW = ROOT / "docs" / "research" / "atlas-terrain-directional-v4-contact-sheet.png"
KINDS = (
    "grass", "meadow", "forest", "hill", "mountain", "coast", "river",
    "stone", "deep_water", "shallow_water",
)
WATER = {"deep_water", "shallow_water", "river"}

PALETTE = {
    "grass": ("#66864f", "#78995a", "#506d45", "#9aae68"),
    "meadow": ("#789857", "#8aaa61", "#617d4c", "#c2ae67"),
    "forest": ("#466b4d", "#315a43", "#244b3b", "#668556"),
    "hill": ("#697b50", "#7f8e5c", "#526441", "#9aa36c"),
    "mountain": ("#68704f", "#687477", "#46545b", "#c9cbbf"),
    "coast": ("#c6ad70", "#d8c17d", "#9e865b", "#eadb9d"),
    "river": ("#66864f", "#3185a2", "#246984", "#61afbf"),
    "stone": ("#818b87", "#96a09a", "#626d6d", "#b8beb3"),
    "deep_water": ("#246682", "#2b7592", "#194e6c", "#4b96aa"),
    "shallow_water": ("#3289a3", "#45a0b4", "#26748e", "#73baca"),
}


def stable(seed: str) -> int:
    value = 2166136261
    for byte in seed.encode():
        value ^= byte
        value = value * 16777619 & 0xFFFFFFFF
    return value


def corridor(draw: ImageDraw.ImageDraw, size: int, mask: int, width: int, color: str) -> None:
    center = size // 2
    low = center - width // 2
    high = low + width - 1
    draw.rectangle((low, low, high, high), fill=color)
    if mask & 1:
        draw.rectangle((low, 0, high, center), fill=color)
    if mask & 2:
        draw.rectangle((center, low, size - 1, high), fill=color)
    if mask & 4:
        draw.rectangle((low, center, high, size - 1), fill=color)
    if mask & 8:
        draw.rectangle((0, low, center, high), fill=color)


def connected_points(size: int, mask: int, seed: int) -> list[list[tuple[int, int]]]:
    """Return slightly irregular center-to-edge strokes for the N/E/S/W mask."""
    center = size // 2
    jitter = max(1, size // 8)
    points: list[list[tuple[int, int]]] = []
    endpoints = ((center, 0), (size - 1, center), (center, size - 1), (0, center))
    for bit, endpoint in zip((1, 2, 4, 8), endpoints):
        if not mask & bit:
            continue
        offset = ((seed >> bit) % (jitter * 2 + 1)) - jitter
        if bit in (1, 4):
            middle = (max(0, min(size - 1, center + offset)), (center + endpoint[1]) // 2)
        else:
            middle = ((center + endpoint[0]) // 2, max(0, min(size - 1, center + offset)))
        points.append([(center, center), middle, endpoint])
    return points


def draw_mountain(draw: ImageDraw.ImageDraw, size: int, mask: int, variant: int, seed: int) -> None:
    """Draw a top-down connected ridge: dark foothills, slopes and a pale crest."""
    _, slope, shadow, crest = PALETTE["mountain"]
    strokes = connected_points(size, mask, seed)
    outer = max(3, size * 5 // 8)
    middle = max(2, size * 3 // 8)
    ridge = max(1, size // 8)
    for points in strokes:
        draw.line(points, fill=shadow, width=outer, joint="curve")
    for points in strokes:
        draw.line(points, fill=slope, width=middle, joint="curve")
    for points in strokes:
        draw.line(points, fill=crest, width=ridge, joint="curve")

    center = size // 2
    peak_count = 1 if size == 8 else 3
    for index in range(peak_count):
        dx = 0 if index == 0 else (-size // 5 if index == 1 else size // 5)
        dy = 0 if index == 0 else (size // 6 if variant % 2 else -size // 6)
        px, py = center + dx, center + dy
        radius = 2 if size == 8 else max(2, size // (5 if index == 0 else 7))
        draw.polygon(((px, py - radius), (px + radius, py), (px, py + radius), (px - radius, py)), fill=shadow)
        draw.polygon(((px, py - radius), (px, py), (px - radius, py)), fill=crest)
        if size >= 16:
            draw.point((px, py - radius), fill="#d9d7c9")


def draw_soft_region(draw: ImageDraw.ImageDraw, size: int, mask: int, mid: str, dark: str) -> None:
    """Blend same-family cells without turning plains into visible pipework."""
    center = size // 2
    radius = max(2, size // 3)
    draw.rectangle((center - radius, center - radius, center + radius, center + radius), fill=mid)
    if mask & 1:
        draw.rectangle((center - radius, 0, center + radius, center), fill=mid)
    if mask & 2:
        draw.rectangle((center, center - radius, size - 1, center + radius), fill=mid)
    if mask & 4:
        draw.rectangle((center - radius, center, center + radius, size - 1), fill=mid)
    if mask & 8:
        draw.rectangle((0, center - radius, center, center + radius), fill=mid)
    if mask != 15:
        draw.point((center - radius, center - radius), fill=dark)


def draw_tile(kind: str, size: int, mask: int, variant: int) -> Image.Image:
    base, mid, dark, light = PALETTE[kind]
    image = Image.new("RGBA", (size, size), base + "ff")
    draw = ImageDraw.Draw(image)
    scale = max(1, size // 8)
    seed = stable(f"{kind}:{size}:{mask}:{variant}")

    if kind == "mountain":
        draw_mountain(draw, size, mask, variant, seed)
    elif kind in {"hill", "forest", "river"}:
        outer = max(3, size // (2 if kind == "mountain" else 3))
        corridor(draw, size, mask, outer, dark)
        inner = max(1, outer - 2 * scale)
        corridor(draw, size, mask, inner, mid)
        if kind == "hill":
            draw.point((size // 2 - scale, size // 2 - scale), fill=light)
        elif kind == "forest":
            for index in range(2 + size // 8):
                x = (seed >> (index * 3)) % size
                y = (seed >> (index * 5 + 1)) % size
                draw.rectangle((x, y, min(size - 1, x + scale), min(size - 1, y + scale)), fill=light if index == 0 else dark)
        else:
            draw.point((max(0, size // 2 - scale), max(0, size // 2 - scale)), fill=light)
    elif kind == "coast":
        width = max(2, size // 3)
        corridor(draw, size, mask, width, mid)
        corridor(draw, size, mask, max(1, width - 2 * scale), light if variant == 2 else dark)
    elif kind == "stone":
        width = max(2, size // 3)
        corridor(draw, size, mask, width, mid)
        for index in range(1 + size // 8):
            x = (seed >> (index * 4)) % size
            y = (seed >> (index * 6 + 2)) % size
            draw.rectangle((x, y, min(size - 1, x + scale), min(size - 1, y + scale)), fill=light if index == 0 else dark)
    elif kind in {"grass", "meadow"}:
        draw_soft_region(draw, size, mask, mid, dark)
        mark_count = 1 if size == 8 else 2
        for index in range(mark_count):
            x = (seed >> (index * 5)) % size
            y = (seed >> (index * 7 + 2)) % size
            draw.point((x, y), fill=light if kind == "meadow" and variant == 2 else dark)
    else:
        # Open water remains seamless; the mask only steers sparse connected ripples.
        width = max(1, size // 8)
        corridor(draw, size, mask, width, mid)
        x = seed % max(1, size - scale)
        y = (seed >> 5) % size
        draw.rectangle((x, y, min(size - 1, x + scale), y), fill=light if variant % 2 else dark)

    return image


def build_level(level: str, size: int) -> None:
    target = OUTPUT / level
    target.mkdir(parents=True, exist_ok=True)
    for kind in KINDS:
        variants = 5 if kind in WATER else 3
        sheet = Image.new("RGBA", (size * 16, size * variants), (0, 0, 0, 0))
        for variant in range(variants):
            for mask in range(16):
                sheet.alpha_composite(draw_tile(kind, size, mask, variant), (mask * size, variant * size))
        sheet.save(target / f"{kind}.png", optimize=True)
    draw_tile("deep_water", size, 15, 0).save(target / "ocean.png", optimize=True)


def build_review() -> None:
    masks = (0, 1, 2, 3, 5, 7, 10, 15)
    kinds = ("mountain", "deep_water", "grass", "coast")
    levels = (("CITY 8x8", 8), ("COUNTRY 16x16", 16), ("PLANET 8x8", 8))
    cell = 40
    label_width = 104
    image = Image.new("RGB", (label_width + len(masks) * cell, 28 + len(levels) * (22 + len(kinds) * cell)), "#07171b")
    draw = ImageDraw.Draw(image)
    for index, mask in enumerate(masks):
        draw.text((label_width + index * cell + 10, 9), f"{mask:02d}", fill="#d9c86d")
    y = 28
    for level, size in levels:
        draw.text((8, y + 4), level, fill="#f2eee0")
        y += 22
        for kind in kinds:
            draw.text((8, y + 14), kind, fill="#9cb7b0")
            for index, mask in enumerate(masks):
                tile = draw_tile(kind, size, mask, 0).resize((32, 32), Image.Resampling.NEAREST)
                image.paste(tile.convert("RGB"), (label_width + index * cell + 4, y + 4))
            y += cell
    REVIEW.parent.mkdir(parents=True, exist_ok=True)
    image.save(REVIEW, optimize=True)


def main() -> None:
    build_level("city", 8)
    build_level("country", 16)
    build_level("planet", 8)
    build_review()
    print("atlas terrain v4: city 8px, country 16px and planet 8px directional sheets built")


if __name__ == "__main__":
    main()
