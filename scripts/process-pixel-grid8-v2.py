"""Build the second exact 8px modular pixel-city asset pack."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
V1 = ROOT / "assets" / "pixel-grid8-v1"
PACK = ROOT / "assets" / "pixel-grid8-v2"
SOURCE = PACK / "source"
TILES = PACK / "tiles"
BUILDINGS = PACK / "buildings"
PROPS = PACK / "props"
SCREENSHOTS = ROOT / "screenshots"

CELL = 8
HOUSE_SIZE = (32, 24)
PROP_SIZE = (8, 16)

HOUSE_NAMES = [f"house-stage-{index}" for index in range(1, 6)]
PROP_NAMES = ["tree-round", "tree-conifer", "tree-flowering", "streetlamp", "utility-pole"]


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = "Arial Bold.ttf" if bold else "Arial.ttf"
    return ImageFont.truetype(f"/System/Library/Fonts/Supplemental/{name}", size)


def hard_pixel_sprite(source: Image.Image, content_size: tuple[int, int], canvas_size: tuple[int, int]) -> Image.Image:
    """Crop, reduce, palette-limit, harden alpha, and bottom-center a generated sprite."""
    source = source.convert("RGBA")
    bbox = source.getchannel("A").getbbox()
    if bbox is None:
        raise RuntimeError("Generated sprite segment is empty")
    cropped = source.crop(bbox)
    reduced = cropped.resize(content_size, Image.Resampling.BOX)
    alpha = reduced.getchannel("A").point(lambda value: 255 if value >= 80 else 0)
    reduced = reduced.quantize(
        colors=18,
        method=Image.Quantize.FASTOCTREE,
        dither=Image.Dither.NONE,
    ).convert("RGBA")
    reduced.putalpha(alpha)
    canvas = Image.new("RGBA", canvas_size, (0, 0, 0, 0))
    x = (canvas_size[0] - content_size[0]) // 2
    y = canvas_size[1] - content_size[1]
    canvas.alpha_composite(reduced, (x, y))
    return canvas


def split_equal_columns(path: Path, count: int = 5) -> list[Image.Image]:
    sheet = Image.open(path).convert("RGBA")
    segments: list[Image.Image] = []
    for index in range(count):
        left = round(index * sheet.width / count)
        right = round((index + 1) * sheet.width / count)
        segments.append(sheet.crop((left, 0, right, sheet.height)))
    return segments


def house_stages() -> dict[str, Image.Image]:
    segments = split_equal_columns(SOURCE / "house-stages.png")
    content_sizes = [(30, 15), (30, 16), (30, 23), (30, 23), (28, 23)]
    return {
        name: hard_pixel_sprite(segment, size, HOUSE_SIZE)
        for name, segment, size in zip(HOUSE_NAMES, segments, content_sizes, strict=True)
    }


def city_props() -> dict[str, Image.Image]:
    segments = split_equal_columns(SOURCE / "city-props.png")
    content_sizes = [(8, 15), (7, 15), (8, 15), (7, 15), (7, 15)]
    return {
        name: hard_pixel_sprite(segment, size, PROP_SIZE)
        for name, segment, size in zip(PROP_NAMES, segments, content_sizes, strict=True)
    }


def grass_tile() -> Image.Image:
    return Image.open(V1 / "tiles" / "grass.png").convert("RGBA")


def road_tile() -> Image.Image:
    return Image.open(V1 / "tiles" / "road.png").convert("RGBA")


def curb_tile() -> Image.Image:
    return Image.open(V1 / "tiles" / "curb.png").convert("RGBA")


def pavement_tile() -> Image.Image:
    image = Image.new("RGBA", (CELL, CELL), "#8fa5adff")
    draw = ImageDraw.Draw(image)
    draw.line((0, 0, 7, 0), fill="#c6d4d5ff")
    draw.line((0, 7, 7, 7), fill="#617885ff")
    draw.point((2, 3), fill="#9fb2b7ff")
    draw.point((6, 5), fill="#7f969fff")
    return image


def checker(size: tuple[int, int], unit: int = 8) -> Image.Image:
    image = Image.new("RGBA", size, "#172524ff")
    draw = ImageDraw.Draw(image)
    for y in range(0, size[1], unit):
        for x in range(0, size[0], unit):
            if (x // unit + y // unit) % 2:
                draw.rectangle((x, y, x + unit - 1, y + unit - 1), fill="#233936ff")
    return image


def tile_background(width_cells: int, height_cells: int, grass: Image.Image) -> Image.Image:
    image = Image.new("RGBA", (width_cells * CELL, height_cells * CELL))
    variants = [
        grass,
        grass.transpose(Image.Transpose.FLIP_LEFT_RIGHT),
        grass.transpose(Image.Transpose.FLIP_TOP_BOTTOM),
        grass.transpose(Image.Transpose.ROTATE_180),
    ]
    for y in range(height_cells):
        for x in range(width_cells):
            image.alpha_composite(variants[(x * 5 + y * 3) % 4], (x * CELL, y * CELL))
    return image


def paint_roads(
    image: Image.Image,
    road_cells: set[tuple[int, int]],
    road: Image.Image,
) -> None:
    for x, y in sorted(road_cells, key=lambda point: (point[1], point[0])):
        variant = road if (x + y) % 2 == 0 else road.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        image.alpha_composite(variant, (x * CELL, y * CELL))


def paint_curbs(
    image: Image.Image,
    road_cells: set[tuple[int, int]],
    curb: Image.Image,
    width_cells: int,
    height_cells: int,
) -> None:
    """Place the same 8x8 curb module on every road-to-grass boundary."""
    top = curb
    bottom = curb.transpose(Image.Transpose.ROTATE_180)
    left = curb.transpose(Image.Transpose.ROTATE_90)
    right = curb.transpose(Image.Transpose.ROTATE_270)
    for x, y in sorted(road_cells, key=lambda point: (point[1], point[0])):
        if y > 0 and (x, y - 1) not in road_cells:
            image.alpha_composite(top, (x * CELL, y * CELL - 3))
        if y < height_cells - 1 and (x, y + 1) not in road_cells:
            image.alpha_composite(bottom, (x * CELL, (y + 1) * CELL - 5))
        if x > 0 and (x - 1, y) not in road_cells:
            image.alpha_composite(left, (x * CELL - 3, y * CELL))
        if x < width_cells - 1 and (x + 1, y) not in road_cells:
            image.alpha_composite(right, ((x + 1) * CELL - 5, y * CELL))


def runtime_road_preview(assets: dict[str, Image.Image]) -> Image.Image:
    """Preview a crossing assembled at render time; this is never exported as an asset."""
    width_cells = height_cells = 8
    image = tile_background(width_cells, height_cells, assets["grass"])
    road_cells = {
        (x, y)
        for y in range(height_cells)
        for x in range(width_cells)
        if 2 <= x <= 5 or 2 <= y <= 5
    }
    paint_roads(image, road_cells, assets["road"])
    paint_curbs(image, road_cells, assets["curb"], width_cells, height_cells)
    draw = ImageDraw.Draw(image)
    # Small lane dashes stop before the conflict area.
    for x in (0, 1, 6, 7):
        draw.line((x * CELL + 2, 31, x * CELL + 5, 31), fill="#dce5e4ff")
    for y in (0, 1, 6, 7):
        draw.line((31, y * CELL + 2, 31, y * CELL + 5), fill="#dce5e4ff")
    return image


def paint_platform(
    image: Image.Image,
    x: int,
    y: int,
    width: int,
    height: int,
    pavement: Image.Image,
) -> None:
    for row in range(height):
        for column in range(width):
            variant = pavement if (column + row) % 2 == 0 else pavement.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            image.alpha_composite(variant, ((x + column) * CELL, (y + row) * CELL))
    draw = ImageDraw.Draw(image)
    draw.rectangle(
        (x * CELL, y * CELL, (x + width) * CELL - 1, (y + height) * CELL - 1),
        outline="#405766ff",
        width=1,
    )


def draw_lane_markings(
    image: Image.Image,
    road_cells: set[tuple[int, int]],
    width_cells: int,
    height_cells: int,
) -> None:
    draw = ImageDraw.Draw(image)
    # Mark a road cell only if it lies in a straight two-sided run. Intersections remain clear.
    for x, y in road_cells:
        horizontal = (x - 1, y) in road_cells and (x + 1, y) in road_cells
        vertical = (x, y - 1) in road_cells and (x, y + 1) in road_cells
        if horizontal and not vertical and x % 2 == 0:
            draw.line((x * CELL + 2, y * CELL + 3, x * CELL + 5, y * CELL + 3), fill="#d8e0e0ff")
        if vertical and not horizontal and y % 2 == 0:
            draw.line((x * CELL + 3, y * CELL + 2, x * CELL + 3, y * CELL + 5), fill="#d8e0e0ff")


def city_scene(assets: dict[str, Image.Image]) -> tuple[Path, Path, Path]:
    """Render a dense playtest city from runtime-composed 8px road cells."""
    width_cells, height_cells = 72, 44
    image = tile_background(width_cells, height_cells, assets["grass"])

    # Six street segments form crosses and T-junctions only by overlapping
    # road cells. There are no crossing, corner, or T-junction sprites.
    road_cells: set[tuple[int, int]] = set()
    road_cells.update((x, y) for x in range(width_cells) for y in range(18, 22))
    road_cells.update((x, y) for x in range(31, 35) for y in range(height_cells))
    road_cells.update((x, y) for x in range(0, 35) for y in range(7, 11))
    road_cells.update((x, y) for x in range(31, width_cells) for y in range(32, 36))
    road_cells.update((x, y) for x in range(53, 57) for y in range(0, 22))
    road_cells.update((x, y) for x in range(12, 16) for y in range(18, height_cells))
    paint_roads(image, road_cells, assets["road"])
    draw_lane_markings(image, road_cells, width_cells, height_cells)
    paint_curbs(image, road_cells, assets["curb"], width_cells, height_cells)

    # Buildings are tasks. Construction stages are intentionally distributed
    # between normal completed buildings instead of being a showroom row.
    houses = [
        ("house-stage-1", 2, 3), ("house-stage-5", 7, 3),
        ("house-stage-2", 17, 3), ("house-stage-5", 22, 3), ("house-stage-5", 27, 3),
        ("house-stage-5", 37, 3), ("house-stage-5", 43, 3), ("house-stage-5", 48, 3),
        ("house-stage-5", 59, 3), ("house-stage-5", 65, 3),
        ("house-stage-5", 2, 13), ("house-stage-5", 7, 13),
        ("house-stage-3", 18, 13), ("house-stage-5", 23, 13), ("house-stage-5", 27, 13),
        ("house-stage-4", 37, 13), ("house-stage-5", 42, 13), ("house-stage-5", 47, 13),
        ("house-stage-5", 59, 13), ("house-stage-5", 65, 13),
        ("house-stage-5", 2, 24), ("house-stage-5", 7, 24),
        ("house-stage-5", 18, 24), ("house-stage-5", 23, 24), ("house-stage-5", 27, 24),
        ("house-stage-5", 37, 24), ("house-stage-5", 42, 24), ("house-stage-5", 47, 24),
        ("house-stage-5", 59, 24), ("house-stage-5", 65, 24),
        ("house-stage-4", 2, 38), ("house-stage-5", 7, 38),
        ("house-stage-5", 18, 38), ("house-stage-5", 23, 38), ("house-stage-5", 27, 38),
        ("house-stage-5", 37, 38), ("house-stage-5", 42, 38), ("house-stage-5", 47, 38),
        ("house-stage-5", 59, 38), ("house-stage-5", 65, 38),
    ]
    shops = [
        ("shop-grocery", 1, 16), ("shop-bakery", 6, 16), ("shop-grocery", 17, 16),
        ("shop-bakery", 22, 16), ("shop-grocery", 37, 16), ("shop-bakery", 42, 16),
        ("shop-grocery", 47, 16), ("shop-bakery", 58, 16), ("shop-grocery", 63, 16),
        ("shop-bakery", 17, 30), ("shop-grocery", 22, 30), ("shop-bakery", 37, 30),
        ("shop-grocery", 42, 30), ("shop-bakery", 47, 30), ("shop-grocery", 59, 30),
        ("shop-bakery", 64, 30),
    ]

    renderables: list[tuple[int, int, str, int, int]] = []
    for name, x, y in houses:
        paint_platform(image, x, y, 4, 3, assets["pavement"])
        renderables.append((y + 3, x + 2, name, x * CELL, y * CELL))
    for name, x, y in shops:
        paint_platform(image, x, y, 4, 2, assets["pavement"])
        renderables.append((y + 2, x + 2, name, x * CELL, y * CELL))

    # Two small parks break the repetition and demonstrate objects whose
    # sprites extend one cell above their one-cell footprint.
    for x, y, width, height in ((17, 23, 12, 7), (58, 23, 11, 7)):
        paint_platform(image, x, y, width, height, assets["pavement"])

    prop_placements = [
        ("tree-round", 18, 25), ("tree-conifer", 21, 27), ("tree-flowering", 24, 25),
        ("tree-round", 27, 28), ("tree-flowering", 19, 29), ("tree-conifer", 26, 26),
        ("tree-round", 59, 25), ("tree-conifer", 62, 27), ("tree-flowering", 65, 25),
        ("tree-round", 68, 28), ("tree-flowering", 60, 29), ("tree-conifer", 67, 26),
        ("tree-round", 36, 7), ("tree-conifer", 40, 9), ("tree-flowering", 44, 7),
        ("tree-round", 48, 9), ("tree-flowering", 51, 7),
        ("streetlamp", 1, 17), ("streetlamp", 10, 17), ("streetlamp", 17, 17),
        ("streetlamp", 29, 17), ("streetlamp", 36, 23), ("streetlamp", 50, 23),
        ("streetlamp", 58, 23), ("streetlamp", 70, 23),
        ("streetlamp", 17, 37), ("streetlamp", 29, 37), ("streetlamp", 36, 37),
        ("streetlamp", 50, 37), ("streetlamp", 58, 37), ("streetlamp", 70, 37),
        ("utility-pole", 30, 6), ("utility-pole", 36, 6),
        ("utility-pole", 11, 30), ("utility-pole", 17, 30),
        ("utility-pole", 52, 30), ("utility-pole", 58, 30),
    ]
    for name, x, ground_y in prop_placements:
        renderables.append((ground_y + 1, x, name, x * CELL, (ground_y - 1) * CELL))

    # Correct top-down overlap: everything uses the bottom anchor as its sort key.
    for _, _, name, x, y in sorted(renderables):
        image.alpha_composite(assets[name], (x, y))

    # Crosswalk paint is a runtime overlay and not part of the road sprites.
    draw = ImageDraw.Draw(image)
    for center_x, center_y in ((33 * CELL, 20 * CELL), (55 * CELL, 20 * CELL), (14 * CELL, 20 * CELL), (33 * CELL, 34 * CELL)):
        for offset in (-10, -6, -2, 2, 6, 10):
            draw.rectangle((center_x + offset, center_y - 20, center_x + offset + 1, center_y - 14), fill="#dce5e4ff")
            draw.rectangle((center_x + offset, center_y + 15, center_x + offset + 1, center_y + 21), fill="#dce5e4ff")

    base_path = SCREENSHOTS / "pixel-grid8-v2-city-base.png"
    image.save(base_path, optimize=True)
    preview = image.resize((image.width * 3, image.height * 3), Image.Resampling.NEAREST)
    preview_path = SCREENSHOTS / "pixel-grid8-v2-city.png"
    preview.convert("RGB").save(preview_path, quality=95)

    # A lightweight UI frame shows the map at the same integer scale it would
    # use inside the web game; the map itself stays a separate artifact.
    game = Image.new("RGB", (preview.width, preview.height + 72), "#0d1818")
    game.paste(preview.convert("RGB"), (0, 72))
    game_draw = ImageDraw.Draw(game)
    game_draw.rectangle((0, 0, game.width, 71), fill="#101c20")
    game_draw.line((0, 71, game.width, 71), fill="#30454b", width=1)
    for column, height in enumerate((12, 20, 16)):
        game_draw.rectangle((24 + column * 7, 42 - height, 28 + column * 7, 42), fill="#76b6d3")
    game_draw.text((52, 20), "TASKTOPIA", font=font(25, True), fill="#eef3ed")
    game_draw.text((245, 16), "СТРАНА", font=font(10, True), fill="#82989b")
    game_draw.text((245, 33), "Брайтленд", font=font(16, True), fill="#dfe7e1")
    game_draw.text((430, 16), "ГОРОД", font=font(10, True), fill="#82989b")
    game_draw.text((430, 33), "Нортпоинт", font=font(16, True), fill="#dfe7e1")
    game_draw.text((game.width - 500, 27), "● 5 в работе     51 завершено     56 задач", font=font(14, True), fill="#b9c7c4")
    game_path = SCREENSHOTS / "pixel-grid8-v2-city-game.png"
    game.save(game_path, quality=95)
    return base_path, preview_path, game_path


def catalog(assets: dict[str, Image.Image]) -> Path:
    canvas = Image.new("RGBA", (1600, 1040), "#0d1818ff")
    draw = ImageDraw.Draw(canvas)
    draw.text((36, 24), "8 PX MODULAR CITY KIT · V2", font=font(30, True), fill="#eef3ed")
    draw.text((36, 68), "5 construction stages · 3 trees · 2 poles · runtime road assembly", font=font(16), fill="#9eb1aa")

    for index, name in enumerate(HOUSE_NAMES):
        x = 36 + index * 300
        y = 120
        canvas.alpha_composite(checker((256, 192), 16), (x, y))
        canvas.alpha_composite(assets[name].resize((256, 192), Image.Resampling.NEAREST), (x, y))
        draw.text((x, y + 202), f"stage {index + 1} · 32×24", font=font(15, True), fill="#dfe7e1")

    for index, name in enumerate(PROP_NAMES):
        x = 36 + index * 180
        y = 410
        canvas.alpha_composite(checker((128, 256), 16), (x, y))
        canvas.alpha_composite(assets[name].resize((128, 256), Image.Resampling.NEAREST), (x, y))
        draw.text((x, y + 266), f"{name} · 8×16", font=font(14, True), fill="#dfe7e1")

    x, y = 1030, 405
    road_preview = runtime_road_preview(assets)
    canvas.alpha_composite(road_preview.resize((512, 512), Image.Resampling.NEAREST), (x, y))
    draw.text((x, y + 522), "runtime assembly · road + curb 8×8", font=font(15, True), fill="#dfe7e1")

    destination = SCREENSHOTS / "pixel-grid8-v2-catalog.png"
    canvas.convert("RGB").save(destination, quality=95)
    return destination


def atlas(assets: dict[str, Image.Image]) -> tuple[Path, dict[str, list[int]]]:
    image = Image.new("RGBA", (256, 128), (0, 0, 0, 0))
    frames: dict[str, list[int]] = {}

    for index, name in enumerate(HOUSE_NAMES):
        x, y = index * 32, 0
        image.alpha_composite(assets[name], (x, y))
        frames[name] = [x, y, 32, 24]
    for index, name in enumerate(PROP_NAMES):
        x, y = index * 8, 24
        image.alpha_composite(assets[name], (x, y))
        frames[name] = [x, y, 8, 16]
    for index, name in enumerate(("grass", "road", "curb", "pavement")):
        x, y = index * 8, 40
        image.alpha_composite(assets[name], (x, y))
        frames[name] = [x, y, 8, 8]
    for index, name in enumerate(("shop-grocery", "shop-bakery")):
        x, y = index * 32, 48
        image.alpha_composite(assets[name], (x, y))
        frames[name] = [x, y, 32, 16]
    path = PACK / "atlas.png"
    image.save(path, optimize=True)
    return path, frames


def validate(assets: dict[str, Image.Image]) -> dict[str, object]:
    expected = {
        **{name: HOUSE_SIZE for name in HOUSE_NAMES},
        **{name: PROP_SIZE for name in PROP_NAMES},
        "grass": (8, 8),
        "road": (8, 8),
        "curb": (8, 8),
        "pavement": (8, 8),
        "shop-grocery": (32, 16),
        "shop-bakery": (32, 16),
    }
    for name, size in expected.items():
        if assets[name].size != size:
            raise RuntimeError(f"{name}: expected {size}, got {assets[name].size}")
        if assets[name].getchannel("A").getbbox() is None:
            raise RuntimeError(f"{name}: sprite is empty")
        if size[0] % CELL or size[1] % CELL:
            raise RuntimeError(f"{name}: dimensions are not divisible by {CELL}")
    for name in HOUSE_NAMES + PROP_NAMES + ["curb"]:
        if assets[name].getchannel("A").getextrema() != (0, 255):
            raise RuntimeError(f"{name}: expected hard transparency")
    return {
        "gridPx": CELL,
        "allDimensionsMultipleOfGrid": True,
        "houseStages": {"count": 5, "spriteSize": list(HOUSE_SIZE), "footprintCells": [4, 3], "anchorPx": [16, 24]},
        "props": {name: {"spriteSize": list(PROP_SIZE), "footprintCells": [1, 1], "anchorPx": [4, 16]} for name in PROP_NAMES},
        "roads": {
            "runtimeAssembly": True,
            "baseTiles": ["road", "curb"],
            "tileSize": [8, 8],
            "roadWidthCells": 4,
        },
    }


def main() -> None:
    for directory in (TILES, BUILDINGS, PROPS, SCREENSHOTS):
        directory.mkdir(parents=True, exist_ok=True)

    assets: dict[str, Image.Image] = {
        "grass": grass_tile(),
        "road": road_tile(),
        "curb": curb_tile(),
        "pavement": pavement_tile(),
        "shop-grocery": Image.open(V1 / "buildings" / "shop-grocery.png").convert("RGBA"),
        "shop-bakery": Image.open(V1 / "buildings" / "shop-bakery.png").convert("RGBA"),
        **house_stages(),
        **city_props(),
    }
    for name in ("grass", "road", "curb", "pavement"):
        assets[name].save(TILES / f"{name}.png", optimize=True)
    for name in HOUSE_NAMES + ["shop-grocery", "shop-bakery"]:
        assets[name].save(BUILDINGS / f"{name}.png", optimize=True)
    for name in PROP_NAMES:
        assets[name].save(PROPS / f"{name}.png", optimize=True)

    validation = validate(assets)
    atlas_path, frames = atlas(assets)
    catalog_path = catalog(assets)
    city_base, city_preview, city_game = city_scene(assets)

    manifest = {
        "version": 2,
        "gridPx": CELL,
        "assets": {
            "tiles": [f"tiles/{name}.png" for name in ("grass", "road", "curb", "pavement")],
            "buildings": [f"buildings/{name}.png" for name in HOUSE_NAMES + ["shop-grocery", "shop-bakery"]],
            "props": [f"props/{name}.png" for name in PROP_NAMES],
            "atlas": "atlas.png",
            "frames": frames,
        },
        "validation": validation,
        "provenance": {
            "houseStages": "built-in image generation; chroma removal; deterministic split and 32x24 normalization",
            "props": "built-in image generation; chroma removal; deterministic split and 8x16 normalization",
            "terrainAndRoads": "deterministic authored 8x8 pixels; all road topology is assembled at render time",
            "storefronts": "reused from pixel-grid8-v1",
        },
    }
    (PACK / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(validation, ensure_ascii=False))
    for path in (atlas_path, catalog_path, city_base, city_preview, city_game):
        print(path.relative_to(ROOT))


if __name__ == "__main__":
    main()
