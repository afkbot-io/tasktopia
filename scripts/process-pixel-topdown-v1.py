"""Build exact 90-degree top-down pointy-hex sprites and a connected preview."""

from __future__ import annotations

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "assets" / "pixel-topdown-v1"
SOURCE = PACK / "source"
TILES = PACK / "tiles"
SCREENSHOTS = ROOT / "screenshots"

TILE_SIZE = (167, 193)
VERTICES = [(83, 0), (166, 48), (166, 144), (83, 192), (0, 144), (0, 48)]
CENTER = (83, 96)
OFFSETS = {
    "NE": (83, -144),
    "E": (166, 0),
    "SE": (83, 144),
    "SW": (-83, 144),
    "W": (-166, 0),
    "NW": (-83, -144),
}
NAMES = ["grass", "forest", "rocks", "water", "road-straight", "river-straight", "building"]


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = "Arial Bold.ttf" if bold else "Arial.ttf"
    return ImageFont.truetype(f"/System/Library/Fonts/Supplemental/{name}", size)


def make_mask() -> Image.Image:
    mask = Image.new("L", TILE_SIZE, 0)
    ImageDraw.Draw(mask).polygon(VERTICES, fill=255)
    return mask


MASK = make_mask()


def normalize(name: str, background: Image.Image | None = None) -> Image.Image:
    source = Image.open(SOURCE / f"{name}.png").convert("RGBA")
    bbox = source.getchannel("A").getbbox()
    if bbox is None:
        raise RuntimeError(f"{name}: transparent source")
    cropped = source.crop(bbox)
    sprite = cropped.resize(TILE_SIZE, Image.Resampling.BOX)
    sprite = sprite.quantize(colors=96, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).convert("RGBA")
    if background is not None:
        sprite = Image.alpha_composite(background, sprite)
    sprite.putalpha(MASK)
    ImageDraw.Draw(sprite).line(VERTICES + [VERTICES[0]], fill="#34442d", width=1)
    return sprite


def axial_top_left(q: int, r: int, origin: tuple[int, int]) -> tuple[int, int]:
    center_x = origin[0] + 166 * q + 83 * r
    center_y = origin[1] + 144 * r
    return center_x - CENTER[0], center_y - CENTER[1]


def build_scene(tiles: dict[str, Image.Image]) -> Path:
    canvas = Image.new("RGBA", (1500, 1080), "#10221fff")
    origin = (750, 550)
    cells: dict[tuple[int, int], str] = {}
    for q in range(-3, 4):
        for r in range(max(-3, -q - 3), min(3, -q + 3) + 1):
            cells[(q, r)] = ["grass", "grass", "forest", "rocks"][(q * 13 + r * 7) % 4]

    # One mathematically continuous road across seven neighboring hexes.
    for q in range(-3, 4):
        cells[(q, 0)] = "road-straight"

    # A small connected lake and a separate river sample.
    for coordinate in [(2, -2), (2, -1), (3, -2)]:
        if coordinate in cells:
            cells[coordinate] = "water"
    cells[(-2, 2)] = "river-straight"
    cells[(1, -1)] = "building"

    ordered = sorted(cells.items(), key=lambda item: (axial_top_left(*item[0], origin)[1], axial_top_left(*item[0], origin)[0]))
    for (q, r), name in ordered:
        canvas.alpha_composite(tiles[name], axial_top_left(q, r, origin))

    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((34, 28, 605, 103), radius=14, fill="#10201eee", outline="#34504a", width=2)
    draw.text((55, 43), "STRICT TOP-DOWN · 90°", font=font(22, True), fill="#eef4ec")
    draw.text((55, 73), "exact shared geometry · no isometric projection", font=font(14), fill="#9cb1aa")
    destination = SCREENSHOTS / "pixel-topdown-v1-scene.png"
    canvas.convert("RGB").save(destination, quality=95)
    return destination


def build_catalog(tiles: dict[str, Image.Image]) -> Path:
    canvas = Image.new("RGBA", (1450, 1000), "#0d1918ff")
    draw = ImageDraw.Draw(canvas)
    draw.text((38, 28), "TOP-DOWN PIXEL HEXES · V1", font=font(28, True), fill="#eef4ec")
    draw.text((38, 68), "Generated materials · deterministic regular hex · identical alpha mask", font=font(15), fill="#91a8a0")
    for index, name in enumerate(NAMES):
        column = index % 4
        row = index // 4
        x = 42 + column * 350
        y = 125 + row * 420
        preview = tiles[name].resize((292, 338), Image.Resampling.NEAREST)
        canvas.alpha_composite(preview, (x, y))
        draw.text((x, y + 348), name, font=font(16, True), fill="#e0e8e2")
    destination = SCREENSHOTS / "pixel-topdown-v1-catalog.png"
    canvas.convert("RGB").save(destination, quality=95)
    return destination


def validate_geometry(tiles: dict[str, Image.Image]) -> dict[str, object]:
    reference_alpha = tiles["grass"].getchannel("A").tobytes()
    identical = all(tile.getchannel("A").tobytes() == reference_alpha for tile in tiles.values())
    lengths = [round(math.dist(VERTICES[i], VERTICES[(i + 1) % 6]), 2) for i in range(6)]
    if not identical:
        raise RuntimeError("tile alpha masks differ")
    if max(lengths) - min(lengths) > 0.2:
        raise RuntimeError("hex is not geometrically regular")
    return {
        "camera": "ORTHOGRAPHIC_TOP_DOWN_90_DEGREES",
        "tileCount": len(tiles),
        "identicalAlphaMasks": True,
        "sideLengthsPx": lengths,
        "sideLengthSpreadPx": round(max(lengths) - min(lengths), 2),
        "neighbourOffsets": {key: list(value) for key, value in OFFSETS.items()},
    }


def main() -> None:
    TILES.mkdir(parents=True, exist_ok=True)
    SCREENSHOTS.mkdir(parents=True, exist_ok=True)
    tiles = {name: normalize(name) for name in NAMES if name != "building"}
    tiles["building"] = normalize("building", tiles["grass"])
    for name, tile in tiles.items():
        tile.save(TILES / f"{name}.png", optimize=True)
    validation = validate_geometry(tiles)
    manifest = {
        "version": 1,
        "projection": "strict vertical orthographic",
        "orientation": "POINTY_TOP",
        "spriteSize": list(TILE_SIZE),
        "vertices": VERTICES,
        "center": list(CENTER),
        "files": [f"tiles/{name}.png" for name in NAMES],
        "validation": validation,
        "provenance": {
            "art": "built-in image generation; one call per concept; grass anchor used as style reference",
            "geometry": "deterministic mask and neighbor layout from scripts/process-pixel-topdown-v1.py",
        },
    }
    (PACK / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    catalog = build_catalog(tiles)
    scene = build_scene(tiles)
    print(json.dumps(validation, ensure_ascii=False))
    print(catalog.relative_to(ROOT))
    print(scene.relative_to(ROOT))


if __name__ == "__main__":
    main()
