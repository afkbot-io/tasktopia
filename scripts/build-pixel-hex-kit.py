"""Build a deterministic pixel-art hex kit with exact shared geometry."""

from __future__ import annotations

import json
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "pixel-hex-kit-v1"
SCREENSHOTS = ROOT / "screenshots"

TILE_WIDTH = 96
TILE_HEIGHT = 83
HEX_VERTICES = [(24, 0), (71, 0), (95, 41), (71, 82), (24, 82), (0, 41)]
BUILDING_SIZE = (96, 144)
BUILDING_ANCHOR = (48, 110)

PALETTE = {
    "edge": "#26362d",
    "edge_light": "#52613a",
    "grass": "#71883d",
    "grass_light": "#879b49",
    "grass_dark": "#536d34",
    "meadow": "#788f42",
    "water": "#286b91",
    "water_light": "#3d87a8",
    "water_dark": "#225779",
    "brick": "#a65338",
    "brick_light": "#c46b49",
    "brick_dark": "#743a2b",
    "roof": "#315f88",
    "roof_light": "#4479a2",
    "roof_dark": "#233f61",
    "trim": "#e2d0a4",
    "glass": "#79b5c6",
    "wood": "#68422f",
    "leaf": "#3f6b38",
    "leaf_light": "#5c8444",
}


def hex_mask() -> Image.Image:
    mask = Image.new("L", (TILE_WIDTH, TILE_HEIGHT), 0)
    ImageDraw.Draw(mask).polygon(HEX_VERTICES, fill=255)
    return mask


HEX_MASK = hex_mask()


def inside(x: int, y: int, margin: int = 0) -> bool:
    if not (0 <= x < TILE_WIDTH and 0 <= y < TILE_HEIGHT):
        return False
    if HEX_MASK.getpixel((x, y)) == 0:
        return False
    if margin == 0:
        return True
    for dx, dy in ((margin, 0), (-margin, 0), (0, margin), (0, -margin)):
        px, py = x + dx, y + dy
        if not (0 <= px < TILE_WIDTH and 0 <= py < TILE_HEIGHT) or HEX_MASK.getpixel((px, py)) == 0:
            return False
    return True


def terrain_sprite(kind: str, seed: int) -> Image.Image:
    base = PALETTE["water"] if kind == "water" else PALETTE["meadow"] if kind == "meadow" else PALETTE["grass"]
    image = Image.new("RGBA", (TILE_WIDTH, TILE_HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.polygon(HEX_VERTICES, fill=base, outline=PALETTE["edge"], width=1)
    draw.line((HEX_VERTICES[0], HEX_VERTICES[1]), fill=PALETTE["edge_light"], width=1)
    draw.line((HEX_VERTICES[5], HEX_VERTICES[0]), fill=PALETTE["edge_light"], width=1)

    rng = random.Random(seed)
    if kind == "water":
        for _ in range(18):
            x, y = rng.randrange(8, 84), rng.randrange(7, 77)
            if inside(x, y, 4):
                length = rng.choice((3, 4, 5, 7))
                color = rng.choice((PALETTE["water_light"], PALETTE["water_dark"]))
                draw.line((x, y, min(94, x + length), y), fill=color, width=1)
    else:
        for _ in range(28):
            x, y = rng.randrange(5, 91), rng.randrange(5, 79)
            if not inside(x, y, 4):
                continue
            color = rng.choice((PALETTE["grass_light"], PALETTE["grass_dark"]))
            if rng.random() < 0.65:
                draw.point((x, y), fill=color)
            else:
                draw.line((x, y, x, y - 2), fill=color, width=1)
                draw.point((x + 1, y - 1), fill=color)
        if kind == "meadow":
            flowers = ("#e9d468", "#d9879c", "#8fb5e0", "#efe6cd")
            for _ in range(10):
                x, y = rng.randrange(10, 86), rng.randrange(10, 74)
                if inside(x, y, 5):
                    draw.point((x, y), fill=rng.choice(flowers))
                    draw.point((x, y + 1), fill=PALETTE["grass_dark"])

    # Force an identical alpha silhouette for every terrain variant.
    image.putalpha(HEX_MASK)
    return image


def building_shadow() -> Image.Image:
    image = Image.new("RGBA", BUILDING_SIZE, (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.polygon([(22, 103), (60, 94), (81, 105), (43, 120)], fill=(20, 29, 27, 92))
    return image


def building_townhouse() -> Image.Image:
    image = Image.new("RGBA", BUILDING_SIZE, (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    # Chimney behind the roof.
    draw.rectangle((64, 37, 71, 57), fill=PALETTE["brick_dark"], outline=PALETTE["edge"])
    draw.rectangle((63, 35, 72, 39), fill=PALETTE["trim"], outline=PALETTE["edge"])

    # Restrained oblique walls: front and one shallow side.
    draw.rectangle((27, 69, 67, 111), fill=PALETTE["brick"], outline=PALETTE["edge"], width=2)
    draw.polygon([(67, 69), (78, 63), (78, 103), (67, 111)], fill=PALETTE["brick_dark"], outline=PALETTE["edge"])
    for y in (77, 87, 97):
        draw.line((29, y, 65, y), fill=PALETTE["brick_light"])
    for y, offset in ((73, 0), (82, 4), (92, 0), (102, 4)):
        for x in range(31 + offset, 65, 8):
            draw.point((x, y), fill=PALETTE["brick_dark"])

    # Roof, drawn last enough to cover the wall top.
    draw.polygon([(21, 69), (46, 43), (70, 69), (66, 75), (46, 53), (27, 75)], fill=PALETTE["roof"], outline=PALETTE["edge"])
    draw.polygon([(46, 43), (70, 51), (81, 63), (70, 69)], fill=PALETTE["roof_dark"], outline=PALETTE["edge"])
    draw.line((25, 68, 46, 46, 68, 68), fill=PALETTE["roof_light"], width=1)
    for offset in (5, 10, 15):
        draw.line((27 + offset, 67 - offset, 46, 49 + offset), fill=PALETTE["roof_light"])
    for y in (54, 59, 64):
        draw.line((53, y, 71, y + 6), fill=PALETTE["roof"])

    # Windows, trim and door.
    for x in (32, 55):
        draw.rectangle((x, 78, x + 8, 88), fill=PALETTE["trim"], outline=PALETTE["edge"])
        draw.rectangle((x + 2, 80, x + 6, 86), fill=PALETTE["glass"])
        draw.line((x + 4, 80, x + 4, 86), fill=PALETTE["roof_dark"])
    draw.rectangle((31, 94, 41, 104), fill=PALETTE["trim"], outline=PALETTE["edge"])
    draw.rectangle((33, 96, 39, 102), fill=PALETTE["glass"])
    draw.rectangle((50, 91, 62, 111), fill=PALETTE["wood"], outline=PALETTE["edge"], width=2)
    draw.rectangle((53, 95, 59, 111), outline=PALETTE["brick_dark"])
    draw.point((59, 102), fill=PALETTE["trim"])

    # Small shrubs belong to the building sprite, but no grass/platform does.
    for center_x, center_y in ((24, 105), (72, 106)):
        draw.rectangle((center_x - 1, center_y + 2, center_x + 1, center_y + 7), fill=PALETTE["wood"])
        draw.ellipse((center_x - 6, center_y - 5, center_x + 6, center_y + 5), fill=PALETTE["leaf"], outline=PALETTE["edge"])
        draw.rectangle((center_x - 2, center_y - 3, center_x + 2, center_y), fill=PALETTE["leaf_light"])

    draw.line((45, 112, 66, 112), fill=PALETTE["edge"], width=2)
    return image


def paste_anchored(canvas: Image.Image, asset: Image.Image, world_anchor: tuple[int, int], asset_anchor: tuple[int, int]) -> None:
    canvas.alpha_composite(asset, (world_anchor[0] - asset_anchor[0], world_anchor[1] - asset_anchor[1]))


def build_preview(tiles: dict[str, Image.Image], building: Image.Image, shadow: Image.Image) -> Path:
    canvas = Image.new("RGBA", (384, 336), "#10211fff")
    positions = {
        "top": (144, 42),
        "upper-left": (73, 83),
        "upper-right": (215, 83),
        "center": (144, 124),
        "lower-left": (73, 165),
        "lower-right": (215, 165),
        "bottom": (144, 206),
    }
    variants = {
        "top": "grass-02",
        "upper-left": "meadow",
        "upper-right": "water",
        "center": "grass-01",
        "lower-left": "grass-02",
        "lower-right": "meadow",
        "bottom": "grass-01",
    }
    for key in sorted(positions, key=lambda item: positions[item][1]):
        canvas.alpha_composite(tiles[variants[key]], positions[key])

    center_anchor = (positions["center"][0] + TILE_WIDTH // 2, positions["center"][1] + TILE_HEIGHT // 2)
    paste_anchored(canvas, shadow, center_anchor, BUILDING_ANCHOR)
    paste_anchored(canvas, building, center_anchor, BUILDING_ANCHOR)

    destination = SCREENSHOTS / "pixel-hex-kit-assembled-v1.png"
    canvas.resize((1152, 1008), Image.Resampling.NEAREST).convert("RGB").save(destination)
    return destination


def label_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = "Arial Bold.ttf" if bold else "Arial.ttf"
    return ImageFont.truetype(f"/System/Library/Fonts/Supplemental/{name}", size)


def build_contact_sheet(tiles: dict[str, Image.Image], building: Image.Image, shadow: Image.Image) -> Path:
    sheet = Image.new("RGBA", (1500, 680), "#0d1b1aff")
    draw = ImageDraw.Draw(sheet)
    draw.text((32, 22), "PIXEL HEX KIT V1 · EXACT FLAT-TOP GEOMETRY", font=label_font(24, True), fill="#ecf0e8")
    draw.text((32, 54), "96×83 terrain · shared alpha mask · exact shared edges · nearest-neighbour only", font=label_font(14), fill="#90aaa5")
    names = ["grass-01", "grass-02", "meadow", "water"]
    for index, name in enumerate(names):
        x = 28 + index * 278
        y = 120
        tile = tiles[name].resize((TILE_WIDTH * 2, TILE_HEIGHT * 2), Image.Resampling.NEAREST)
        sheet.alpha_composite(tile, (x + 40, y))
        draw.text((x + 40, y + 184), name, font=label_font(16, True), fill="#dce6dd")
        draw.text((x + 40, y + 208), "96×83 PNG", font=label_font(12), fill="#78938e")
    checker = Image.new("RGBA", (250, 410), "#182a29ff")
    checker_draw = ImageDraw.Draw(checker)
    for y in range(0, 410, 20):
        for x in range(0, 250, 20):
            if (x // 20 + y // 20) % 2:
                checker_draw.rectangle((x, y, x + 19, y + 19), fill="#203735")
    sheet.alpha_composite(checker, (1205, 110))
    sheet.alpha_composite(shadow.resize((192, 288), Image.Resampling.NEAREST), (1234, 122))
    sheet.alpha_composite(building.resize((192, 288), Image.Resampling.NEAREST), (1234, 122))
    draw.text((1205, 538), "townhouse", font=label_font(16, True), fill="#dce6dd")
    draw.text((1205, 562), "96×144 PNG · anchor 48,110", font=label_font(12), fill="#78938e")
    draw.text((32, 614), "Every terrain sprite has byte-identical alpha geometry. The building contains no grass and is positioned only by its anchor.", font=label_font(14), fill="#a9bbb6")
    destination = SCREENSHOTS / "pixel-hex-kit-elements-v1.png"
    sheet.convert("RGB").save(destination)
    return destination


def validate(tiles: dict[str, Image.Image], building: Image.Image) -> dict[str, object]:
    alpha_reference = next(iter(tiles.values())).getchannel("A").tobytes()
    for name, image in tiles.items():
        if image.size != (TILE_WIDTH, TILE_HEIGHT):
            raise RuntimeError(f"{name}: unexpected size {image.size}")
        if image.getchannel("A").tobytes() != alpha_reference:
            raise RuntimeError(f"{name}: alpha geometry differs")
        if len(image.getcolors(maxcolors=100_000) or []) > 32:
            raise RuntimeError(f"{name}: palette is larger than 32 colors")
    if building.size != BUILDING_SIZE or building.getchannel("A").getbbox() is None:
        raise RuntimeError("building: invalid sprite")
    lengths = []
    for index, start in enumerate(HEX_VERTICES):
        end = HEX_VERTICES[(index + 1) % len(HEX_VERTICES)]
        lengths.append(round(math.dist(start, end), 2))
    neighbour_edges = [
        (0, 3, (0, -82)),
        (1, 4, (71, -41)),
        (2, 5, (71, 41)),
        (3, 0, (0, 82)),
        (4, 1, (-71, 41)),
        (5, 2, (-71, -41)),
    ]
    for own_edge, neighbour_edge, (offset_x, offset_y) in neighbour_edges:
        own = {HEX_VERTICES[own_edge], HEX_VERTICES[(own_edge + 1) % 6]}
        neighbour = {
            (HEX_VERTICES[neighbour_edge][0] + offset_x, HEX_VERTICES[neighbour_edge][1] + offset_y),
            (HEX_VERTICES[(neighbour_edge + 1) % 6][0] + offset_x, HEX_VERTICES[(neighbour_edge + 1) % 6][1] + offset_y),
        }
        if own != neighbour:
            raise RuntimeError(f"edge {own_edge}: neighbour geometry does not meet exactly")
    return {
        "terrainSprites": len(tiles),
        "identicalAlphaGeometry": True,
        "allSixNeighbourEdgesMeetExactly": True,
        "sideLengthsPx": lengths,
        "sideLengthSpreadPx": round(max(lengths) - min(lengths), 2),
        "buildingTransparent": building.getchannel("A").getpixel((0, 0)) == 0,
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    SCREENSHOTS.mkdir(parents=True, exist_ok=True)
    tiles = {
        "grass-01": terrain_sprite("grass", 101),
        "grass-02": terrain_sprite("grass", 207),
        "meadow": terrain_sprite("meadow", 313),
        "water": terrain_sprite("water", 419),
    }
    for name, image in tiles.items():
        image.save(OUT / f"terrain-{name}.png", optimize=True)
    shadow = building_shadow()
    building = building_townhouse()
    shadow.save(OUT / "building-townhouse-shadow.png", optimize=True)
    building.save(OUT / "building-townhouse.png", optimize=True)

    validation = validate(tiles, building)
    manifest = {
        "version": 1,
        "style": "low-resolution pixel art; nearest-neighbour only",
        "orientation": "FLAT_TOP",
        "terrain": {
            "spriteSize": [TILE_WIDTH, TILE_HEIGHT],
            "vertices": HEX_VERTICES,
            "columnStep": 71,
            "rowStep": 82,
            "oddColumnOffsetY": 41,
            "files": [f"terrain-{name}.png" for name in tiles],
        },
        "building": {
            "key": "townhouse",
            "spriteSize": list(BUILDING_SIZE),
            "anchor": list(BUILDING_ANCHOR),
            "footprint": [[0, 0]],
            "file": "building-townhouse.png",
            "shadowFile": "building-townhouse-shadow.png",
            "containsTerrain": False,
        },
        "validation": validation,
        "provenance": "procedural 2D pixel art generated by scripts/build-pixel-hex-kit.py",
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    preview = build_preview(tiles, building, shadow)
    contact = build_contact_sheet(tiles, building, shadow)
    print(json.dumps(validation, ensure_ascii=False))
    print(preview.relative_to(ROOT))
    print(contact.relative_to(ROOT))


if __name__ == "__main__":
    main()
