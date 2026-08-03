"""Create exact 8px modular terrain tiles and 32x16 storefront sprites."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "assets" / "pixel-grid8-v1"
SOURCE = PACK / "source"
TILES = PACK / "tiles"
BUILDINGS = PACK / "buildings"
SCREENSHOTS = ROOT / "screenshots"

CELL = 8
SHOP_SIZE = (32, 16)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = "Arial Bold.ttf" if bold else "Arial.ttf"
    return ImageFont.truetype(f"/System/Library/Fonts/Supplemental/{name}", size)


def grass_tile() -> Image.Image:
    image = Image.new("RGBA", (CELL, CELL), "#667c46ff")
    pixels = image.load()
    for x, y in [(1, 2), (6, 5)]:
        pixels[x, y] = (92, 113, 63, 255)
    for x, y in [(5, 1), (2, 6)]:
        pixels[x, y] = (112, 133, 75, 255)
    return image


def road_tile() -> Image.Image:
    image = Image.new("RGBA", (CELL, CELL), "#394257ff")
    pixels = image.load()
    for x, y in [(1, 0), (5, 1), (3, 3), (7, 4), (0, 6), (4, 7)]:
        pixels[x, y] = (55, 62, 79, 255)
    for x, y in [(3, 0), (6, 3), (2, 6), (7, 7)]:
        pixels[x, y] = (70, 77, 94, 255)
    return image


def curb_tile() -> Image.Image:
    image = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.line((0, 3, 7, 3), fill="#26384aff", width=1)
    draw.line((0, 4, 7, 4), fill="#c3d1d5ff", width=1)
    draw.line((0, 5, 7, 5), fill="#8da3adff", width=1)
    draw.line((0, 6, 7, 6), fill="#526b78ff", width=1)
    for x in (1, 5):
        image.putpixel((x, 4), (225, 232, 230, 255))
    for x in (3, 7):
        image.putpixel((x, 5), (108, 132, 143, 255))
    return image


def storefront(name: str) -> Image.Image:
    source = Image.open(SOURCE / f"{name}.png").convert("RGBA")
    bbox = source.getchannel("A").getbbox()
    if bbox is None:
        raise RuntimeError(f"{name}: empty source")
    cropped = source.crop(bbox)
    # Keep a one-pixel transparent safety margin while retaining a 32x16
    # runtime canvas and a bottom-aligned anchor.
    sprite = cropped.resize((30, 15), Image.Resampling.BOX)
    alpha = sprite.getchannel("A").point(lambda value: 255 if value >= 72 else 0)
    quantized = sprite.quantize(colors=24, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).convert("RGBA")
    quantized.putalpha(alpha)
    target = Image.new("RGBA", SHOP_SIZE, (0, 0, 0, 0))
    target.alpha_composite(quantized, (1, 1))
    return target


def checker(size: tuple[int, int], unit: int = 8) -> Image.Image:
    image = Image.new("RGBA", size, "#1a2928ff")
    draw = ImageDraw.Draw(image)
    for y in range(0, size[1], unit):
        for x in range(0, size[0], unit):
            if (x // unit + y // unit) % 2:
                draw.rectangle((x, y, x + unit - 1, y + unit - 1), fill="#243a37ff")
    return image


def build_atlas(assets: dict[str, Image.Image]) -> Path:
    atlas = Image.new("RGBA", (64, 32), (0, 0, 0, 0))
    atlas.alpha_composite(assets["grass"], (0, 0))
    atlas.alpha_composite(assets["road"], (8, 0))
    atlas.alpha_composite(assets["curb"], (16, 0))
    atlas.alpha_composite(assets["shop-grocery"], (0, 8))
    atlas.alpha_composite(assets["shop-bakery"], (32, 8))
    destination = PACK / "atlas.png"
    atlas.save(destination, optimize=True)
    return destination


def build_catalog(assets: dict[str, Image.Image]) -> Path:
    canvas = Image.new("RGBA", (1440, 820), "#0d1818ff")
    draw = ImageDraw.Draw(canvas)
    draw.text((38, 28), "8 PX MODULAR CITY KIT · V1", font=font(30, True), fill="#eef3ed")
    draw.text((38, 72), "terrain 8×8 · storefronts 32×16 · nearest-neighbor preview", font=font(16), fill="#9eb1aa")

    tile_names = ["grass", "road", "curb"]
    for index, name in enumerate(tile_names):
        x = 40 + index * 250
        y = 130
        panel = checker((160, 160), 16)
        canvas.alpha_composite(panel, (x, y))
        preview = assets[name].resize((128, 128), Image.Resampling.NEAREST)
        canvas.alpha_composite(preview, (x + 16, y + 16))
        draw.text((x, y + 174), f"{name} · 8×8", font=font(16, True), fill="#dfe7e1")

    for index, name in enumerate(("shop-grocery", "shop-bakery")):
        x = 40 + index * 650
        y = 405
        panel = checker((576, 288), 16)
        canvas.alpha_composite(panel, (x, y))
        preview = assets[name].resize((512, 256), Image.Resampling.NEAREST)
        canvas.alpha_composite(preview, (x + 32, y + 16))
        draw.text((x, y + 298), f"{name} · 32×16 · footprint 4×2", font=font(16, True), fill="#dfe7e1")

    destination = SCREENSHOTS / "pixel-grid8-v1-catalog.png"
    canvas.convert("RGB").save(destination, quality=95)
    return destination


def build_scene(assets: dict[str, Image.Image]) -> tuple[Path, Path]:
    width_cells, height_cells = 40, 24
    base = Image.new("RGBA", (width_cells * CELL, height_cells * CELL), "#617b43ff")
    grass_variants = [
        assets["grass"],
        assets["grass"].transpose(Image.Transpose.FLIP_LEFT_RIGHT),
        assets["grass"].transpose(Image.Transpose.FLIP_TOP_BOTTOM),
        assets["grass"].transpose(Image.Transpose.ROTATE_180),
    ]
    for y in range(height_cells):
        for x in range(width_cells):
            base.alpha_composite(grass_variants[(x * 5 + y * 3) % len(grass_variants)], (x * CELL, y * CELL))

    road_start, road_end = 11, 17
    for y in range(road_start, road_end):
        for x in range(width_cells):
            road = assets["road"] if (x + y) % 2 == 0 else assets["road"].transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            base.alpha_composite(road, (x * CELL, y * CELL))

    top_curb_y = road_start * CELL - 3
    bottom_curb_y = road_end * CELL - 5
    bottom_curb = assets["curb"].rotate(180, resample=Image.Resampling.NEAREST)
    for x in range(width_cells):
        base.alpha_composite(assets["curb"], (x * CELL, top_curb_y))
        base.alpha_composite(bottom_curb, (x * CELL, bottom_curb_y))

    # Each storefront is exactly four cells wide and two cells tall.
    base.alpha_composite(assets["shop-grocery"], (5 * CELL, 9 * CELL))
    base.alpha_composite(assets["shop-bakery"], (11 * CELL, 9 * CELL))

    base_path = SCREENSHOTS / "pixel-grid8-v1-scene-base.png"
    base.save(base_path, optimize=True)
    preview = base.resize((base.width * 4, base.height * 4), Image.Resampling.NEAREST)
    preview_path = SCREENSHOTS / "pixel-grid8-v1-scene.png"
    preview.convert("RGB").save(preview_path, quality=95)
    return base_path, preview_path


def validate(assets: dict[str, Image.Image]) -> dict[str, object]:
    for name in ("grass", "road", "curb"):
        if assets[name].size != (8, 8):
            raise RuntimeError(f"{name}: expected 8x8, got {assets[name].size}")
    for name in ("shop-grocery", "shop-bakery"):
        if assets[name].size != SHOP_SIZE:
            raise RuntimeError(f"{name}: expected 32x16, got {assets[name].size}")
        if assets[name].getchannel("A").getbbox() is None:
            raise RuntimeError(f"{name}: empty sprite")
    return {
        "gridPx": CELL,
        "allDimensionsMultipleOfGrid": True,
        "terrainTiles": {name: [8, 8] for name in ("grass", "road", "curb")},
        "buildings": {
            name: {"spriteSize": [32, 16], "footprintCells": [4, 2], "anchorPx": [16, 16]}
            for name in ("shop-grocery", "shop-bakery")
        },
    }


def main() -> None:
    TILES.mkdir(parents=True, exist_ok=True)
    BUILDINGS.mkdir(parents=True, exist_ok=True)
    SCREENSHOTS.mkdir(parents=True, exist_ok=True)
    assets = {
        "grass": grass_tile(),
        "road": road_tile(),
        "curb": curb_tile(),
        "shop-grocery": storefront("shop-grocery"),
        "shop-bakery": storefront("shop-bakery"),
    }
    for name in ("grass", "road", "curb"):
        assets[name].save(TILES / f"{name}.png", optimize=True)
    for name in ("shop-grocery", "shop-bakery"):
        assets[name].save(BUILDINGS / f"{name}.png", optimize=True)
    validation = validate(assets)
    atlas = build_atlas(assets)
    catalog = build_catalog(assets)
    base_scene, scene = build_scene(assets)
    manifest = {
        "version": 1,
        "gridPx": CELL,
        "assets": {
            "tiles": [f"tiles/{name}.png" for name in ("grass", "road", "curb")],
            "buildings": [f"buildings/{name}.png" for name in ("shop-grocery", "shop-bakery")],
            "atlas": "atlas.png",
        },
        "validation": validation,
        "provenance": {
            "terrain": "deterministic authored pixels",
            "buildings": "built-in image generation using the supplied sprite sheet as style reference; chroma removal and deterministic 32x16 normalization",
        },
    }
    (PACK / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(validation, ensure_ascii=False))
    for path in (atlas, catalog, base_scene, scene):
        print(path.relative_to(ROOT))


if __name__ == "__main__":
    main()
