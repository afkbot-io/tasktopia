#!/usr/bin/env python3
"""Build the shared native-pixel compact construction kit; never paints buildings.

The four small props compose stage two inside a 5–6-cell site. Stage one uses
only the low modular fence. Run before merging compact-kit-manifest.json into
the asset manifest; this script deliberately does not rewrite that manifest.
"""

import json
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "assets" / "pixel-city-pack"
OUTPUTS = (PACK / "runtime", ROOT / "public" / "game-assets" / "v5")
PROFILE = "TASKTOPIA_V7_COMPACT_CONSTRUCTION_45"
MATERIAL_PROFILE = "TASKTOPIA_V5_CITY_MATERIALS_2026"
CELL = 8
PALETTE = {
    "edge": "#59695f",
    "shadow": "#6d7564",
    "earth": "#a49c78",
    "earth_light": "#b8af87",
    "earth_dark": "#918e70",
    "gold": "#cbb575",
    "gold_light": "#e1ca89",
    "gold_dark": "#9f8d58",
    "blue": "#668a85",
    "blue_light": "#86a6a0",
    "glass": "#446a6b",
    "glass_light": "#94b8ae",
    "brick": "#a97759",
    "brick_light": "#c7956b",
    "brick_dark": "#86694f",
    "sand": "#c5b17c",
    "sand_light": "#dfcb91",
    "sand_dark": "#a39368",
}


def canvas(size):
    return Image.new("RGBA", size, (0, 0, 0, 0))


def rect(draw, bounds, color):
    draw.rectangle(bounds, fill=PALETTE[color])


def foundation(variant):
    image = canvas((8, 8))
    draw = ImageDraw.Draw(image)
    rect(draw, (0, 0, 7, 7), "earth")
    # Quiet square joints echo terrain tiles; no noisy aggregate or black border.
    rect(draw, (0, 0, 7, 0), "earth_light")
    rect(draw, (0, 1, 0, 7), "earth_light")
    rect(draw, (7, 1, 7, 7), "earth_dark")
    rect(draw, (1, 7, 6, 7), "earth_dark")
    for x, y in (((2, 2), (5, 5)), ((4, 2), (2, 5)), ((2, 3), (5, 2)))[variant]:
        rect(draw, (x, y, x + 1, y), "earth_light")
    return image


def fence(kind):
    image = canvas((8, 8))
    draw = ImageDraw.Draw(image)
    if kind == "fence":
        rect(draw, (0, 3, 7, 3), "gold_light")
        rect(draw, (0, 4, 7, 4), "gold_dark")
        rect(draw, (3, 3, 3, 4), "gold")
    elif kind == "fence-corner":
        # North-west corner; runtime quarter turns connect the other three.
        rect(draw, (3, 3, 7, 3), "gold_light")
        rect(draw, (3, 4, 7, 4), "gold_dark")
        rect(draw, (3, 4, 3, 7), "gold_light")
        rect(draw, (4, 5, 4, 7), "gold_dark")
    elif kind == "fence-post":
        rect(draw, (3, 2, 4, 5), "gold_dark")
        rect(draw, (3, 2, 4, 3), "gold_light")
    else:
        # A short hinge at the outer edge; no bar through the two-cell opening.
        rect(draw, (0, 3, 1, 4), "gold_light")
        rect(draw, (1, 4, 1, 5), "gold_dark")
    return image


def crane():
    image = canvas((16, 24))
    draw = ImageDraw.Draw(image)
    # The broad top boom and base use the same square 45-degree top/front grammar.
    rect(draw, (4, 18, 12, 22), "shadow")
    rect(draw, (3, 17, 11, 21), "gold")
    rect(draw, (3, 17, 11, 18), "gold_light")
    rect(draw, (3, 22, 12, 23), "gold_dark")
    rect(draw, (6, 4, 9, 19), "gold_dark")
    rect(draw, (6, 3, 8, 18), "gold")
    rect(draw, (6, 3, 6, 18), "gold_light")
    for y in range(7, 18, 4):
        rect(draw, (7, y, 8, y + 1), "gold_light")
    rect(draw, (0, 2, 15, 4), "gold_dark")
    rect(draw, (0, 0, 15, 2), "gold")
    rect(draw, (0, 0, 15, 0), "gold_light")
    for x in (2, 5, 9, 12):
        rect(draw, (x, 1, x, 2), "gold_dark")
    rect(draw, (0, 2, 2, 5), "blue")
    rect(draw, (0, 2, 2, 3), "blue_light")
    rect(draw, (14, 5, 14, 13), "edge")
    rect(draw, (12, 13, 14, 14), "gold_dark")
    rect(draw, (10, 14, 13, 16), "brick")
    rect(draw, (10, 14, 13, 14), "brick_light")
    return image


def hut():
    image = canvas((16, 8))
    draw = ImageDraw.Draw(image)
    rect(draw, (1, 0, 14, 4), "blue_light")
    rect(draw, (0, 1, 15, 3), "blue_light")
    rect(draw, (1, 4, 14, 7), "blue")
    rect(draw, (1, 4, 14, 4), "shadow")
    rect(draw, (3, 1, 11, 1), "glass_light")
    rect(draw, (10, 5, 12, 7), "glass")
    rect(draw, (3, 5, 6, 6), "glass")
    rect(draw, (3, 5, 5, 5), "glass_light")
    rect(draw, (1, 7, 8, 7), "shadow")
    return image


def bricks():
    image = canvas((8, 8))
    draw = ImageDraw.Draw(image)
    rect(draw, (0, 6, 7, 7), "gold_dark")
    rect(draw, (1, 2, 6, 6), "brick")
    rect(draw, (1, 1, 6, 3), "brick_light")
    rect(draw, (3, 1, 3, 2), "brick_dark")
    rect(draw, (1, 4, 6, 4), "brick_dark")
    rect(draw, (4, 5, 4, 6), "brick_dark")
    return image


def sand():
    image = canvas((8, 8))
    draw = ImageDraw.Draw(image)
    rect(draw, (1, 4, 6, 7), "sand_dark")
    rect(draw, (0, 3, 7, 6), "sand")
    rect(draw, (1, 2, 6, 4), "sand")
    rect(draw, (2, 1, 5, 3), "sand_light")
    rect(draw, (1, 4, 2, 4), "sand_light")
    rect(draw, (5, 5, 6, 5), "sand_dark")
    return image


def save(image, path):
    assert image.width % CELL == 0 and image.height % CELL == 0
    assert set(image.getchannel("A").tobytes()) <= {0, 255}
    assert len(image.getcolors(image.width * image.height)) <= 32
    for output in OUTPUTS:
        target = output / path
        target.parent.mkdir(parents=True, exist_ok=True)
        image.save(target, optimize=True)


def main():
    tiles, props = {}, {}
    previews = []
    for index, suffix in enumerate("abc"):
        key = f"compact-construction-foundation-{suffix}"
        image = foundation(index)
        path = f"tiles/{key}.png"
        save(image, path)
        tiles[key] = {"path": path, "size": [8, 8], "overlay": False, "materialRole": "CONSTRUCTION", "visualProfile": MATERIAL_PROFILE}
        previews.append(image)
    for suffix in ("fence", "fence-corner", "fence-post", "gate"):
        key = f"compact-construction-{suffix}"
        image = fence(suffix)
        path = f"tiles/{key}.png"
        save(image, path)
        tiles[key] = {"path": path, "size": [8, 8], "overlay": True, "materialRole": "CONSTRUCTION_OVERLAY", "visualProfile": MATERIAL_PROFILE}
        previews.append(image)
    for suffix, label, painter, footprint in (
        ("crane", "Компактный строительный кран", crane, [2, 2]),
        ("hut", "Компактная строительная бытовка", hut, [2, 1]),
        ("bricks", "Поддон кирпича", bricks, [1, 1]),
        ("sand", "Строительный песок", sand, [1, 1]),
    ):
        key = f"compact-construction-{suffix}"
        image = painter()
        path = f"props/{key}.png"
        save(image, path)
        props[key] = {"label": label, "path": path, "size": list(image.size), "footprintCells": footprint, "anchorPx": [image.width // 2, image.height], "artSource": "PROCEDURAL_TILE_KIT", "visualProfile": PROFILE}
        previews.append(image)
    fragment = {"tiles": tiles, "props": props}
    target = PACK / "compact-kit-manifest.json"
    target.write_text(json.dumps(fragment, ensure_ascii=False, indent=2) + "\n")
    sheet = Image.new("RGBA", (len(previews) * 24, 32), "#81975b")
    for index, image in enumerate(previews):
        sheet.alpha_composite(image, (index * 24 + (24 - image.width) // 2, 28 - image.height))
    review = ROOT / "screenshots" / "compact-construction-kit.png"
    review.parent.mkdir(parents=True, exist_ok=True)
    sheet.resize((sheet.width * 4, sheet.height * 4), Image.Resampling.NEAREST).save(review)
    print(json.dumps({"tiles": len(tiles), "props": len(props), "manifestFragment": str(target), "review": str(review)}))


if __name__ == "__main__":
    main()
