"""Build the deterministic square-grid runtime asset pack used by Tasktopia V3.

AI output is reference-only. Every runtime image produced here has exact dimensions,
hard alpha and a stable manifest contract suitable for automated validation.
"""

from __future__ import annotations

import json
import shutil
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
V3 = ROOT / "assets" / "pixel-city-pack-v3"
PACK = ROOT / "assets" / "pixel-city-pack-v4"
RUNTIME = PACK / "runtime"
PUBLIC = ROOT / "public" / "game-assets" / "v4"
SCREENSHOTS = ROOT / "screenshots"
CATALOG = PACK / "catalog"
SOURCE_ART = PACK / "sources"
CELL = 8
REGISTERED_RULES = {"STANDARD", "UNIQUE_SERVICE", "REQUIRES_COLLECTOR"}

OUTLINE = "#263945ff"
SHADOW = "#40515aff"
GLASS = "#62b7c6ff"
FRAME = "#a8744fff"
SCAFFOLD = "#d3ad58ff"
CONCRETE = "#9fa7a3ff"
CAR_PALETTES = {
    "blue": ("#183f55ff", "#226f8cff", "#2f94a6ff", "#54bdc6ff"),
    "red": ("#51252cff", "#9c3439ff", "#cf4744ff", "#ed6a5aff"),
    "yellow": ("#5f4823ff", "#aa7724ff", "#d9a838ff", "#f1cf5aff"),
    "green": ("#1c4d39ff", "#2f7850ff", "#43a967ff", "#69cf82ff"),
}
WALKER_SKIN = "#d2a074ff"
WALKER_HAIR = "#3f342fff"
WALKER_LEGS = "#263945ff"
WALKER_SHIRTS = ("#4f8ca5ff", "#c07a55ff", "#6f9a59ff", "#9a6aa5ff")


@dataclass(frozen=True)
class HouseSpec:
    key: str
    label: str
    size: tuple[int, int]
    footprint: tuple[int, int]
    wall: str
    dark: str
    roof: str
    accent: str
    style: str
    rarity: str = "COMMON"
    category: str = "HOUSE"


def load_generated_specs() -> list[HouseSpec]:
    raw_specs: list[dict] = []
    for catalog_name in ("generated-buildings.json", "generated-buildings-v5.json"):
        catalog_path = CATALOG / catalog_name
        if catalog_path.exists(): raw_specs.extend(json.loads(catalog_path.read_text()))
    palettes = {
        "HOUSE": (("#d9c9a5ff", "#8d745fff", "#35576bff", "#c96d55ff"), ("#c9d2c2ff", "#718277ff", "#4c6f5fff", "#d2a64dff"), ("#d9b99dff", "#91624fff", "#594b6fff", "#52a3b1ff")),
        "COMMERCIAL": (("#d8c9a8ff", "#647178ff", "#357c78ff", "#e1b84fff"), ("#c6d1cfff", "#596c73ff", "#9b554cff", "#58a8b5ff"), ("#d8b397ff", "#765c58ff", "#4d647fff", "#d89052ff")),
        "CIVIC": (("#dad4c4ff", "#747b7aff", "#426e78ff", "#c75750ff"), ("#c9d4d2ff", "#66757aff", "#54688cff", "#d6b151ff"), ("#d8c6adff", "#80695cff", "#477166ff", "#b66a55ff")),
        "HIGHRISE": (("#b8d2d6ff", "#55727bff", "#3d6274ff", "#d5b850ff"), ("#c6cbc9ff", "#616b70ff", "#6a526fff", "#55aab7ff"), ("#d2c7b7ff", "#75665dff", "#415f7cff", "#cf7358ff")),
    }
    result: list[HouseSpec] = []
    for index, raw in enumerate(raw_specs):
        category = raw.get("category", "HOUSE")
        palette = palettes[category][index % len(palettes[category])]
        result.append(HouseSpec(
        key=raw["key"], label=raw["label"], size=tuple(raw["spriteSize"]),
        footprint=tuple(raw["footprintCells"]), wall=raw.get("wall", palette[0]), dark=raw.get("dark", palette[1]),
        roof=raw.get("roof", palette[2]), accent=raw.get("accent", palette[3]), style=raw["style"],
        rarity=raw.get("rarity", "COMMON"), category=category,
        ))
    return result


TERRAIN_PALETTES: dict[str, tuple[str, tuple[str, ...]]] = {
    "GRASS": ("#667f3dff", ("#789348ff", "#526d35ff", "#8ca554ff")),
    "MEADOW": ("#78914aff", ("#8faa58ff", "#627e40ff", "#d4c65aff")),
    "FOREST": ("#3e663bff", ("#527a43ff", "#2f5233ff", "#719252ff")),
    "HILL": ("#647145ff", ("#7f8954ff", "#4f5e3bff", "#9a9360ff")),
    "MOUNTAIN": ("#59615fff", ("#78807dff", "#3e4749ff", "#a4aaa4ff")),
    "SAND": ("#c8a663ff", ("#ddbd76ff", "#a98750ff", "#edd092ff")),
    "WET_SAND": ("#9b8258ff", ("#b59a6aff", "#77684eff", "#c4aa78ff")),
    "CLAY": ("#a86245ff", ("#c17854ff", "#814934ff", "#d18a62ff")),
    "STONE": ("#737b78ff", ("#919895ff", "#565e5dff", "#a8aba3ff")),
    "SHALLOW_WATER": ("#287da4ff", ("#3d94b7ff", "#1e668fff", "#72b6c8ff")),
    "DEEP_WATER": ("#1c5d86ff", ("#27729bff", "#16496fff", "#4d91adff")),
    "DIRT": ("#876742ff", ("#a17b4eff", "#684e35ff", "#b18a59ff")),
}


def rgba(hex_color: str) -> tuple[int, int, int, int]:
    return tuple(bytes.fromhex(hex_color.removeprefix("#")))  # type: ignore[return-value]


def terrain_tile(kind: str, variant: int) -> Image.Image:
    base, details = TERRAIN_PALETTES[kind]
    image = Image.new("RGBA", (CELL, CELL), rgba(base))
    draw = ImageDraw.Draw(image)
    seed = sum(ord(char) for char in kind) * 17 + variant * 31
    for index in range(5):
        x = (seed + index * 5 + variant * 3) % CELL
        y = (seed // 3 + index * 3 + variant) % CELL
        color = details[(index + variant) % len(details)]
        if "WATER" in kind:
            length = 2 + (index % 3)
            draw.line((x, y, min(CELL - 1, x + length), y), fill=rgba(color))
        elif kind in {"STONE", "MOUNTAIN"}:
            draw.rectangle((x, y, min(CELL - 1, x + 1), min(CELL - 1, y + 1)), fill=rgba(color))
        elif kind == "HILL":
            draw.line((max(0, x - 1), y, min(CELL - 1, x + 2), y), fill=rgba(color))
        else:
            draw.point((x, y), fill=rgba(color))
    if "WATER" in kind and variant >= 3:
        fish = "#174c68ff" if kind == "SHALLOW_WATER" else "#123d5bff"
        # Tiny fish shadows follow the generated reference without turning a
        # seamless terrain tile into a busy illustration.
        positions = ((2, 3),) if variant == 3 else ((1, 2), (5, 5))
        for x, y in positions:
            draw.line((x, y, x + 2, y), fill=rgba(fish))
            draw.point((x - 1, y - 1), fill=rgba(fish))
            draw.point((x - 1, y + 1), fill=rgba(fish))
    return image


def transparent_tile() -> Image.Image:
    return Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))


def path_tile(kind: str) -> Image.Image:
    base = "#7e8681ff" if kind == "pavers" else "#596166ff"
    image = Image.new("RGBA", (CELL, CELL), rgba(base))
    draw = ImageDraw.Draw(image)
    if kind == "pavers":
        for y in range(0, CELL, 3):
            draw.line((0, y, CELL - 1, y), fill=rgba("#a6ada7ff"))
            offset = 2 if (y // 3) % 2 else 0
            for x in range(offset, CELL, 4): draw.point((x, min(CELL - 1, y + 1)), fill=rgba("#59625fff"))
    else:
        draw.line((0, 1, CELL - 1, 1), fill=rgba("#70787aff"))
        draw.point((2, 5), fill=rgba("#454d51ff")); draw.point((6, 3), fill=rgba("#454d51ff"))
    return image


def topdown_vertical_car(palette: tuple[str, str, str, str]) -> Image.Image:
    image = Image.new("RGBA", (8, 16), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rectangle((1, 1, 6, 14), fill=rgba(palette[1]), outline=rgba(OUTLINE))
    draw.rectangle((2, 0, 5, 1), fill=rgba(palette[2]), outline=rgba(OUTLINE))
    for x in (0, 7):
        draw.rectangle((x, 4, x, 6), fill=rgba("#131c22ff"))
        draw.rectangle((x, 10, x, 12), fill=rgba("#131c22ff"))
    draw.rectangle((2, 3, 5, 5), fill=rgba("#264956ff"))
    draw.line((2, 4, 5, 4), fill=rgba("#4e8997ff"))
    draw.rectangle((2, 6, 5, 10), fill=rgba(palette[2]))
    draw.line((2, 6, 5, 6), fill=rgba(palette[3]))
    draw.rectangle((2, 11, 5, 12), fill=rgba("#264956ff"))
    for x in (2, 5):
        draw.point((x, 1), fill=rgba("#f5dc8fff"))
        draw.point((x, 14), fill=rgba("#bf3d37ff"))
    return image


def edge_overlay(material: str, direction: str) -> Image.Image:
    image = transparent_tile()
    draw = ImageDraw.Draw(image)
    color = {
        "shore": "#d2b06dff",
        "wet-shore": "#a58a5fff",
        "stone": "#858d88ff",
    }[material]
    lines = {
        "N": (0, 0, 7, 1), "E": (6, 0, 7, 7), "S": (0, 6, 7, 7), "W": (0, 0, 1, 7),
    }
    draw.rectangle(lines[direction], fill=rgba(color))
    return image


def prop_flower(color: str, variant: int) -> Image.Image:
    image = transparent_tile()
    draw = ImageDraw.Draw(image)
    for x, y in ((2, 4), (5, 3), (4, 6)):
        draw.point((x, y), fill=rgba("#4c7138ff"))
        draw.point((x, y - 1), fill=rgba(color))
    if variant % 2:
        draw.point((6, 6), fill=rgba("#6d8b43ff"))
    return image


def prop_bush(kind: int) -> Image.Image:
    image = transparent_tile()
    draw = ImageDraw.Draw(image)
    colors = (("#385b35ff", "#638348ff"), ("#496c3cff", "#7e9b55ff"), ("#3b653aff", "#b45b52ff"))[kind]
    draw.rectangle((1, 4, 6, 7), fill=rgba(colors[0]))
    draw.rectangle((2, 2, 5, 6), fill=rgba(colors[1]))
    if kind == 2:
        draw.point((3, 3), fill=rgba("#d36b62ff")); draw.point((5, 5), fill=rgba("#d36b62ff"))
    return image


def prop_shrub(kind: str) -> Image.Image:
    image = transparent_tile()
    draw = ImageDraw.Draw(image)
    palettes = {
        "hazel": ("#355c39ff", "#6f914dff"), "fern": ("#315a3bff", "#78a354ff"),
        "flowering": ("#476a3dff", "#d78ca3ff"), "dry": ("#75643fff", "#b39a56ff"),
        "hedge": ("#365f3aff", "#598049ff"), "juniper": ("#31564aff", "#60866cff"),
    }
    dark, light = palettes[kind]
    if kind == "fern":
        for x in (1, 3, 5, 7): draw.line((4, 7, x, 2 + x % 3), fill=rgba(light))
    elif kind == "hedge":
        draw.rectangle((0, 3, 7, 7), fill=rgba(dark), outline=rgba(OUTLINE))
        for x in (1, 4, 6): draw.point((x, 3 + x % 2), fill=rgba(light))
    else:
        draw.ellipse((0, 3, 7, 7), fill=rgba(dark), outline=rgba(OUTLINE))
        draw.rectangle((2, 2, 5, 6), fill=rgba(light))
        if kind == "flowering":
            for point in ((1, 4), (4, 2), (6, 5)): draw.point(point, fill=rgba("#f0c8d1ff"))
        if kind == "dry": draw.line((1, 2, 6, 7), fill=rgba("#d0b36aff"))
    return image


def prop_rock(kind: int) -> Image.Image:
    image = transparent_tile()
    draw = ImageDraw.Draw(image)
    if kind == 0:
        draw.polygon([(1, 6), (2, 3), (5, 2), (7, 5), (6, 7), (2, 7)], fill=rgba("#69716fff"), outline=rgba(OUTLINE))
        draw.line((3, 3, 5, 3), fill=rgba("#929996ff"))
    else:
        draw.polygon([(0, 7), (1, 4), (3, 3), (4, 6), (5, 3), (7, 4), (7, 7)], fill=rgba("#727976ff"), outline=rgba(OUTLINE))
    return image


def prop_reed(cattail: bool) -> Image.Image:
    image = Image.new("RGBA", (8, 16), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    for x, top in ((1, 5), (3, 2), (5, 6), (6, 3)):
        draw.line((x, 14, x, top), fill=rgba("#678244ff"))
        if cattail and x in (3, 6): draw.rectangle((x, top, x + 1, top + 2), fill=rgba("#85573cff"))
    return image


def prop_tree(kind: str) -> Image.Image:
    image = Image.new("RGBA", (8, 16), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    trunk = "#75563cff"
    palettes = {
        "birch": ("#d7d2b9ff", "#82a657ff", "#5f8348ff"),
        "pine": ("#6d523bff", "#315a3bff", "#47734aff"),
        "willow": (trunk, "#64884cff", "#86a85bff"),
        "oak": (trunk, "#426d3eff", "#6f914dff"),
        "apple": (trunk, "#507a43ff", "#7b9a50ff"),
        "cherry": (trunk, "#b87585ff", "#dc9aabff"),
        "maple": (trunk, "#456d39ff", "#c2783fff"),
        "cedar": (trunk, "#294e3aff", "#426a4bff"),
        "cypress": (trunk, "#2c5139ff", "#527548ff"),
        "palm": (trunk, "#3f7044ff", "#78a653ff"),
        "aspen": ("#d8d1b7ff", "#71934eff", "#a6b85cff"),
        "deadwood": ("#806447ff", "#806447ff", "#aa895bff"),
        "magnolia": (trunk, "#507346ff", "#e6c2cfff"),
        "redwood": ("#83543cff", "#294e38ff", "#416b43ff"),
    }
    stem, dark, light = palettes[kind]
    draw.rectangle((3, 8, 4, 15), fill=rgba(stem), outline=rgba(OUTLINE))
    if kind in {"pine", "cedar", "cypress", "redwood"}:
        draw.polygon([(4, 0), (1, 7), (3, 7), (0, 11), (7, 11), (5, 7), (7, 7)], fill=rgba(dark), outline=rgba(OUTLINE))
        draw.line((3, 3, 5, 8), fill=rgba(light))
        if kind == "cypress": draw.rectangle((2, 1, 5, 12), fill=rgba(light), outline=rgba(OUTLINE))
        if kind == "redwood": draw.line((1, 5, 6, 5), fill=rgba(light))
    elif kind == "palm":
        draw.line((4, 1, 4, 12), fill=rgba(stem), width=2)
        for end in ((0, 3), (7, 2), (1, 0), (7, 6)): draw.line((4, 2, *end), fill=rgba(light), width=2)
    elif kind == "deadwood":
        draw.line((4, 1, 4, 15), fill=rgba(stem), width=2)
        draw.line((4, 5, 1, 2), fill=rgba(light)); draw.line((4, 7, 7, 3), fill=rgba(light))
    elif kind == "willow":
        draw.ellipse((0, 1, 7, 10), fill=rgba(light), outline=rgba(OUTLINE))
        for x in (1, 3, 6): draw.line((x, 6, x, 13), fill=rgba(dark))
    elif kind == "oak":
        draw.rectangle((0, 4, 7, 10), fill=rgba(dark), outline=rgba(OUTLINE))
        draw.rectangle((1, 1, 6, 8), fill=rgba(light), outline=rgba(OUTLINE))
    else:
        draw.ellipse((0, 2, 7, 10), fill=rgba(light), outline=rgba(OUTLINE))
        draw.rectangle((1, 4, 6, 8), fill=rgba(dark))
        if kind == "apple":
            draw.point((2, 4), fill=rgba("#c9584fff")); draw.point((6, 7), fill=rgba("#c9584fff"))
        if kind == "birch":
            draw.point((3, 10), fill=rgba(OUTLINE)); draw.point((4, 13), fill=rgba(OUTLINE))
        if kind == "magnolia":
            draw.point((1, 4), fill=rgba("#f1d8e0ff")); draw.point((6, 6), fill=rgba("#f1d8e0ff"))
    return image


def prop_streetlamp(kind: str) -> Image.Image:
    image = Image.new("RGBA", (8, 16), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    metal = "#42545cff"
    light = "#ead277ff"
    draw.rectangle((3, 5, 4, 15), fill=rgba(metal), outline=rgba(OUTLINE))
    if kind == "vintage":
        draw.line((3, 5, 1, 2, 5, 2), fill=rgba(metal))
        draw.rectangle((1, 1, 5, 4), fill=rgba(light), outline=rgba(OUTLINE))
    elif kind == "modern":
        draw.line((4, 5, 7, 3), fill=rgba(metal), width=2)
        draw.rectangle((5, 2, 7, 4), fill=rgba(light), outline=rgba(OUTLINE))
    elif kind == "solar":
        draw.polygon([(1, 1), (6, 1), (7, 3), (2, 3)], fill=rgba("#315f72ff"), outline=rgba(OUTLINE))
        draw.rectangle((4, 4, 7, 5), fill=rgba(light), outline=rgba(OUTLINE))
    elif kind == "industrial":
        draw.line((4, 5, 6, 1), fill=rgba(metal), width=2)
        draw.rectangle((5, 0, 7, 2), fill=rgba(light), outline=rgba(OUTLINE))
    elif kind == "double":
        draw.line((3, 5, 1, 2), fill=rgba(metal)); draw.line((4, 5, 6, 2), fill=rgba(metal))
        draw.rectangle((0, 1, 2, 3), fill=rgba(light), outline=rgba(OUTLINE)); draw.rectangle((5, 1, 7, 3), fill=rgba(light), outline=rgba(OUTLINE))
    else:
        draw.line((3, 5, 1, 2, 6, 2), fill=rgba(metal))
        draw.rectangle((1, 1, 5, 3), fill=rgba(light), outline=rgba(OUTLINE))
        draw.point((0, 5), fill=rgba("#c85f58ff")); draw.point((7, 5), fill=rgba("#6ba0c4ff"))
    return image


PARK_FEATURE_SIZES: dict[str, tuple[int, int]] = {
    "fountain-large": (32, 32), "gazebo": (32, 32), "bandstand": (40, 32),
    "statue-hero": (16, 24), "statue-abstract": (16, 24),
    "topiary-spiral": (8, 16), "topiary-animal": (16, 16), "pond-small": (24, 24),
    "flower-bed-horizontal": (24, 8), "flower-bed-vertical": (8, 24),
    "park-bench-double": (24, 16), "park-bridge": (32, 16), "park-lamp": (8, 16),
    "park-path-circle": (24, 24), "playground-slide": (24, 16), "playground-carousel": (24, 24),
}

PARK_FEATURE_FOOTPRINTS: dict[str, tuple[int, int]] = {
    "fountain-large": (4, 4), "gazebo": (4, 3), "bandstand": (5, 3),
    "statue-hero": (2, 2), "statue-abstract": (2, 2),
    "topiary-spiral": (1, 1), "topiary-animal": (2, 1), "pond-small": (3, 3),
    "flower-bed-horizontal": (3, 1), "flower-bed-vertical": (1, 3),
    "park-bench-double": (3, 1), "park-bridge": (4, 2), "park-lamp": (1, 1),
    "park-path-circle": (3, 3), "playground-slide": (3, 2), "playground-carousel": (3, 3),
}


def prop_park_feature(kind: str) -> Image.Image:
    """Draw large park furniture on the shared 8 px grid.

    These are finished ambient props rather than task-progress buildings, so
    they intentionally have independent variants instead of fake construction
    stages. Every silhouette remains readable at native scale.
    """
    width, height = PARK_FEATURE_SIZES[kind]
    image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    stone, stone_light = "#697477ff", "#aab4b1ff"
    green, green_light = "#426d3eff", "#75a151ff"
    wood, wood_light = "#75563cff", "#ad8352ff"
    water, water_light = "#287ba0ff", "#55a8c1ff"
    gold = "#d8b64fff"
    if kind == "fountain-large":
        draw.ellipse((2, 19, 29, 30), fill=rgba(stone), outline=rgba(OUTLINE), width=2)
        draw.ellipse((5, 20, 26, 27), fill=rgba(water), outline=rgba(stone_light))
        draw.rectangle((14, 10, 17, 23), fill=rgba(stone_light), outline=rgba(OUTLINE))
        draw.ellipse((10, 7, 21, 13), fill=rgba(stone), outline=rgba(OUTLINE))
        draw.line((15, 1, 15, 8), fill=rgba(water_light), width=2)
        draw.point((11, 5), fill=rgba(water_light)); draw.point((20, 5), fill=rgba(water_light))
    elif kind in {"gazebo", "bandstand"}:
        left, right = 3, width - 4
        draw.rectangle((left + 3, height - 7, right - 3, height - 2), fill=rgba(wood_light), outline=rgba(OUTLINE))
        for x in (left + 4, right - 4): draw.rectangle((x, 10, x + 1, height - 7), fill=rgba(stone_light), outline=rgba(OUTLINE))
        draw.polygon([(left, 11), (width // 2, 2), (right, 11)], fill=rgba("#466f6aff" if kind == "gazebo" else "#9a4f46ff"), outline=rgba(OUTLINE))
        draw.line((left + 3, 12, right - 3, 12), fill=rgba(gold))
        if kind == "bandstand":
            draw.rectangle((width // 2 - 5, height - 14, width // 2 + 5, height - 8), fill=rgba("#52636aff"), outline=rgba(OUTLINE))
    elif kind.startswith("statue-"):
        draw.rectangle((3, height - 7, width - 4, height - 2), fill=rgba(stone), outline=rgba(OUTLINE))
        draw.rectangle((5, height - 13, width - 6, height - 7), fill=rgba(stone_light), outline=rgba(OUTLINE))
        if kind == "statue-hero":
            draw.rectangle((7, 5, 9, height - 13), fill=rgba("#5d756dff"), outline=rgba(OUTLINE))
            draw.ellipse((6, 2, 10, 6), fill=rgba("#718a80ff"), outline=rgba(OUTLINE))
            draw.line((7, 9, 3, 6), fill=rgba("#5d756dff"), width=2)
        else:
            draw.polygon([(4, height - 13), (7, 3), (12, 7), (9, 14), (13, height - 13)], fill=rgba("#718a80ff"), outline=rgba(OUTLINE))
    elif kind.startswith("topiary-"):
        draw.rectangle((width // 2 - 1, height - 7, width // 2, height - 2), fill=rgba(wood), outline=rgba(OUTLINE))
        if kind == "topiary-spiral":
            draw.polygon([(4, 1), (1, 4), (6, 6), (1, 9), (6, 12), (3, 14)], fill=rgba(green_light), outline=rgba(OUTLINE))
        else:
            draw.ellipse((2, 4, 12, 11), fill=rgba(green), outline=rgba(OUTLINE))
            draw.rectangle((10, 2, 14, 7), fill=rgba(green_light), outline=rgba(OUTLINE))
            for x in (4, 10): draw.line((x, 11, x, 14), fill=rgba(green))
    elif kind == "pond-small":
        draw.ellipse((1, 8, width - 2, height - 2), fill=rgba("#b99d68ff"), outline=rgba(OUTLINE))
        draw.ellipse((3, 9, width - 4, height - 4), fill=rgba(water), outline=rgba(water_light))
        draw.line((6, 15, 9, 15), fill=rgba(water_light)); draw.line((14, 19, 19, 19), fill=rgba(water_light))
        draw.line((4, 7, 4, 13), fill=rgba(green)); draw.point((5, 8), fill=rgba(green_light))
    elif kind.startswith("flower-bed-"):
        draw.rounded_rectangle((0, 1, width - 1, height - 1), radius=2, fill=rgba("#684f38ff"), outline=rgba(OUTLINE))
        for y in range(3, height - 2, 5):
            for x in range(3, width - 2, 5):
                draw.point((x, y), fill=rgba(("#e5bf4fff", "#d26455ff", "#9a79c1ff")[(x + y) % 3]))
    elif kind == "park-bench-double":
        for y in (5, 11):
            draw.rectangle((2, y, width - 3, y + 2), fill=rgba(wood_light), outline=rgba(OUTLINE))
        for x in (4, width - 6): draw.line((x, 4, x, height - 2), fill=rgba(stone))
    elif kind == "park-bridge":
        draw.polygon([(1, 11), (7, 6), (width - 8, 6), (width - 2, 11), (width - 2, 14), (1, 14)], fill=rgba(wood_light), outline=rgba(OUTLINE))
        draw.line((2, 7, 7, 2, width - 8, 2, width - 3, 7), fill=rgba(wood), width=2)
        for x in range(6, width - 5, 5): draw.line((x, 3, x, 9), fill=rgba(wood))
    elif kind == "park-lamp":
        draw.rectangle((3, 5, 4, 15), fill=rgba(stone), outline=rgba(OUTLINE))
        draw.ellipse((0, 0, 7, 6), fill=rgba(gold), outline=rgba(OUTLINE))
        draw.rectangle((1, 2, 6, 4), fill=rgba("#f0db86ff"))
    elif kind == "park-path-circle":
        draw.ellipse((1, 1, width - 2, height - 2), fill=rgba("#b7aa8bff"), outline=rgba(OUTLINE), width=2)
        draw.ellipse((6, 6, width - 7, height - 7), fill=(0, 0, 0, 0), outline=rgba("#7e806fff"), width=2)
    elif kind == "playground-slide":
        draw.line((4, 2, 4, 13), fill=rgba(stone_light), width=2)
        draw.line((4, 4, 15, 13), fill=rgba("#d45b4fff"), width=3)
        draw.line((16, 13, 21, 13), fill=rgba("#d45b4fff"), width=2)
        draw.rectangle((1, 1, 8, 4), fill=rgba(gold), outline=rgba(OUTLINE))
    elif kind == "playground-carousel":
        draw.ellipse((3, 12, 20, 21), fill=rgba("#d45b4fff"), outline=rgba(OUTLINE))
        draw.line((11, 3, 11, 17), fill=rgba(stone_light), width=2)
        draw.line((4, 9, 18, 9), fill=rgba(gold), width=2)
        for x in (5, 17): draw.line((x, 9, x, 17), fill=rgba("#4d8fa8ff"))
    return image


def prop_landform(kind: str) -> Image.Image:
    size = (16, 16) if kind.startswith("hill") else (16, 24) if kind == "mountain-peak" else (24, 16)
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    if kind == "hill-small":
        draw.polygon([(1, 14), (4, 8), (8, 5), (13, 9), (15, 14)], fill=rgba("#6f7d4aff"), outline=rgba(OUTLINE))
        draw.line((5, 10, 10, 8), fill=rgba("#9a9a62ff"))
    elif kind == "hill-rocky":
        draw.polygon([(0, 15), (3, 8), (7, 4), (11, 7), (15, 15)], fill=rgba("#66704dff"), outline=rgba(OUTLINE))
        draw.polygon([(5, 10), (7, 5), (10, 9), (9, 12)], fill=rgba("#858c87ff"), outline=rgba("#485153ff"))
    elif kind == "mountain-peak":
        draw.polygon([(0, 23), (3, 15), (8, 3), (13, 14), (15, 23)], fill=rgba("#626b69ff"), outline=rgba(OUTLINE))
        draw.polygon([(5, 10), (8, 3), (11, 10), (9, 9), (8, 12), (7, 8)], fill=rgba("#c7cdc7ff"))
        draw.line((3, 17, 8, 12, 13, 17), fill=rgba("#858d89ff"))
    else:
        draw.polygon([(0, 15), (3, 9), (7, 5), (11, 10), (15, 4), (20, 9), (23, 15)], fill=rgba("#626a68ff"), outline=rgba(OUTLINE))
        draw.line((3, 11, 7, 7, 11, 12, 15, 7, 20, 11), fill=rgba("#929996ff"))
    return image


def prop_bus_stop(vertical: bool) -> Image.Image:
    size = (8, 16) if vertical else (16, 16)
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    if vertical:
        draw.rectangle((1, 4, 6, 14), fill=rgba("#9fb7bcff"), outline=rgba(OUTLINE))
        draw.rectangle((2, 5, 5, 10), fill=rgba("#4d8fa8ff"))
        draw.line((0, 3, 7, 3), fill=rgba("#e1bf55ff"), width=2)
        draw.rectangle((2, 12, 5, 14), fill=rgba("#52636aff"))
    else:
        draw.rectangle((1, 5, 14, 14), fill=rgba("#9fb7bcff"), outline=rgba(OUTLINE))
        draw.rectangle((2, 6, 13, 10), fill=rgba("#4d8fa8ff"))
        draw.line((0, 4, 15, 4), fill=rgba("#e1bf55ff"), width=2)
        draw.rectangle((4, 12, 11, 14), fill=rgba("#52636aff"))
    return image


def prop_city_sign(vertical: bool) -> Image.Image:
    image = Image.new("RGBA", (8, 16), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.line((3, 7, 3, 15), fill=rgba("#83979bff"))
    draw.line((5, 7, 5, 15), fill=rgba("#83979bff"))
    draw.rectangle((0, 2, 7, 8), fill=rgba("#e4dfcaff"), outline=rgba(OUTLINE))
    draw.rectangle((1, 3, 6, 7), fill=rgba("#315f7bff"))
    if vertical:
        draw.line((3, 4, 3, 6), fill=rgba("#dce8e4ff"))
    else:
        draw.line((2, 5, 5, 5), fill=rgba("#dce8e4ff"))
    return image


def prop_walker(direction: str, color: str) -> Image.Image:
    image = transparent_tile()
    draw = ImageDraw.Draw(image)
    draw.rectangle((3, 1, 4, 2), fill=rgba(WALKER_SKIN))
    draw.rectangle((2, 3, 5, 5), fill=rgba(color), outline=rgba(OUTLINE))
    if direction in "NS":
        draw.point((2, 6), fill=rgba(WALKER_LEGS)); draw.point((5, 6), fill=rgba(WALKER_LEGS))
        draw.point((3, 0 if direction == "N" else 2), fill=rgba(WALKER_HAIR))
    else:
        draw.point((2, 6), fill=rgba(WALKER_LEGS)); draw.point((5, 6), fill=rgba(WALKER_LEGS))
        draw.point((2 if direction == "W" else 5, 2), fill=rgba(WALKER_HAIR))
    return image


def prop_animal(species: str, direction: str) -> Image.Image:
    image = transparent_tile()
    draw = ImageDraw.Draw(image)
    body = {"fox": "#b7653fff", "deer": "#9b774fff", "rabbit": "#aaa89cff", "boar": "#665044ff", "duck": "#527052ff", "sheep": "#d8d3c5ff", "dog": "#9b673fff", "cat": "#6f7474ff"}[species]
    light = {"fox": "#dfb071ff", "deer": "#c6a879ff", "rabbit": "#ddd8c8ff", "boar": "#9a7960ff", "duck": "#d0aa43ff", "sheep": "#f0eadcff", "dog": "#d5a366ff", "cat": "#aeb4b0ff"}[species]
    if direction in "EW":
        draw.rectangle((2, 3, 6, 5), fill=rgba(body), outline=rgba(OUTLINE))
        head_x = 6 if direction == "E" else 1
        draw.rectangle((head_x, 2, head_x + 1, 4), fill=rgba(body))
        tail_x = 0 if direction == "E" else 7
        draw.line((tail_x, 3, 2 if direction == "E" else 6, 4), fill=rgba(light))
        draw.point((3, 6), fill=rgba(OUTLINE)); draw.point((6, 6), fill=rgba(OUTLINE))
    else:
        draw.rectangle((2, 2, 5, 6), fill=rgba(body), outline=rgba(OUTLINE))
        head_y = 1 if direction == "N" else 6
        draw.rectangle((3, head_y, 4, min(7, head_y + 1)), fill=rgba(light))
        draw.point((2, 7 if direction == "S" else 1), fill=rgba(OUTLINE)); draw.point((5, 7 if direction == "S" else 1), fill=rgba(OUTLINE))
    if species == "deer":
        draw.point((2, 1), fill=rgba("#5a4435ff")); draw.point((5, 1), fill=rgba("#5a4435ff"))
    elif species == "rabbit":
        draw.point((2, 1), fill=rgba(light)); draw.point((5, 1), fill=rgba(light))
    elif species == "boar":
        draw.point((1 if direction == "W" else 6, 5), fill=rgba("#e5d2a8ff"))
    elif species == "duck":
        draw.point((1 if direction == "W" else 7, 3), fill=rgba("#e1b844ff"))
    elif species == "sheep":
        draw.point((2, 3), fill=rgba(light)); draw.point((5, 4), fill=rgba(light))
    elif species in {"dog", "cat"}:
        draw.point((2, 1), fill=rgba(body)); draw.point((5, 1), fill=rgba(body))
    return image


def prop_boat(horizontal: bool, variant: int) -> Image.Image:
    # Three cells give the hull a readable slender proportion at gameplay
    # zoom. The seated passenger reuses the walker's exact 2 px head / 4 px
    # torso anatomy and palette, so boats do not introduce a second human
    # visual language.
    size = (24, 8) if horizontal else (8, 24)
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    wood = "#9a6d3fff" if variant == 0 else "#7f5938ff"
    light = "#c49557ff" if variant == 0 else "#ad7b48ff"
    shirt = WALKER_SHIRTS[variant % 2]
    if horizontal:
        draw.polygon([(1, 5), (4, 2), (19, 2), (22, 5), (19, 7), (4, 7)], fill=rgba(wood), outline=rgba(OUTLINE))
        draw.rectangle((5, 3, 18, 6), fill=rgba("#5c432fff"))
        for x in (6, 17): draw.line((x, 3, x, 6), fill=rgba(light))
        draw.rectangle((11, 0, 12, 1), fill=rgba(WALKER_SKIN))
        draw.point((11, 1), fill=rgba(WALKER_HAIR))
        draw.rectangle((10, 2, 13, 4), fill=rgba(shirt), outline=rgba(OUTLINE))
        draw.line((4, 1, 19, 7), fill=rgba("#c4a064ff"))
    else:
        draw.polygon([(4, 1), (7, 4), (7, 19), (4, 22), (1, 19), (1, 4)], fill=rgba(wood), outline=rgba(OUTLINE))
        draw.rectangle((2, 5, 6, 18), fill=rgba("#5c432fff"))
        for y in (6, 17): draw.line((2, y, 6, y), fill=rgba(light))
        draw.rectangle((3, 8, 4, 9), fill=rgba(WALKER_SKIN))
        draw.point((3, 9), fill=rgba(WALKER_HAIR))
        draw.rectangle((2, 10, 5, 12), fill=rgba(shirt), outline=rgba(OUTLINE))
        draw.line((0, 4, 7, 19), fill=rgba("#c4a064ff"))
    return image


def prop_airplane(variant: int = 0) -> Image.Image:
    """Small left-to-right aircraft in the pack's frontal-top projection."""
    image = Image.new("RGBA", (32, 16), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    # Fuselage and nose.
    fuselage = ("#d9dfd8ff", "#d8cfb4ff", "#cadbe1ff")[variant]
    accent = ("#e5c552ff", "#c65b4fff", "#4f8ca5ff")[variant]
    draw.polygon([(2, 7), (7, 5), (25, 5), (30, 7), (25, 9), (7, 9)], fill=rgba(fuselage), outline=rgba(OUTLINE))
    draw.rectangle((7, 6, 24, 8), fill=rgba(("#c1ccc9ff", "#b8aa8dff", "#abc5ceff")[variant]))
    draw.polygon([(25, 6), (30, 7), (25, 8)], fill=rgba(accent), outline=rgba(OUTLINE))
    # Swept wings expose a shallow top plane, matching the map camera.
    wing = [(13, 6), (18, 1), (22, 1), (19, 7), (22, 13), (18, 13), (13, 8)] if variant != 2 else [(12, 6), (16, 0), (20, 0), (19, 7), (20, 14), (16, 14), (12, 8)]
    draw.polygon(wing, fill=rgba(("#8faeb5ff", "#9b8e76ff", "#7aa0adff")[variant]), outline=rgba(OUTLINE))
    draw.line((17, 3, 20, 3), fill=rgba("#d9dfd8ff"))
    draw.line((17, 11, 20, 11), fill=rgba("#657983ff"))
    # Tail fin and cockpit window keep the silhouette readable at 1x.
    draw.polygon([(5, 6), (2, 2), (6, 2), (9, 7), (6, 8), (3, 12), (1, 12), (3, 8)], fill=rgba("#557988ff"), outline=rgba(OUTLINE))
    draw.rectangle((23, 6, 25, 7), fill=rgba(GLASS), outline=rgba("#657983ff"))
    if variant == 1:
        draw.rectangle((10, 5, 11, 9), fill=rgba(accent)); draw.rectangle((19, 5, 20, 9), fill=rgba(accent))
    elif variant == 2:
        draw.point((11, 7), fill=rgba("#f4f6edff")); draw.point((21, 7), fill=rgba("#f4f6edff"))
    return image


def prop_fire_engine(variant: int = 0) -> Image.Image:
    """Three-cell emergency vehicle using the same top/front car grammar."""
    image = Image.new("RGBA", (24, 8), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    body = ("#b83e3eff", "#cf4a3fff", "#9f3438ff")[variant]
    cab = ("#e7e1d2ff", "#d4c85fff", "#d8dde0ff")[variant]
    rear = 16 if variant != 2 else 14
    draw.rectangle((2, 2, rear, 6), fill=rgba(body), outline=rgba(OUTLINE))
    draw.polygon([(rear, 2), (20, 2), (22, 4), (22, 6), (rear, 6)], fill=rgba(cab), outline=rgba(OUTLINE))
    draw.rectangle((17, 3, 20, 4), fill=rgba(GLASS), outline=rgba("#4b6972ff"))
    if variant == 0:
        draw.rectangle((4, 1, 14, 2), fill=rgba("#d7d9d2ff"), outline=rgba(OUTLINE))
    elif variant == 1:
        draw.ellipse((5, 1, 13, 5), outline=rgba("#d7d9d2ff"), width=2)
    else:
        draw.rectangle((3, 1, 13, 3), fill=rgba("#6c7780ff"), outline=rgba(OUTLINE))
        draw.line((4, 2, 12, 2), fill=rgba("#aeb9b6ff"))
    for x in (5, 9, 13): draw.point((x, 1), fill=rgba("#71878cff"))
    for x in (5, 17):
        draw.rectangle((x, 6, x + 3, 7), fill=rgba("#141e23ff"))
        draw.point((x + 1, 6), fill=rgba("#78878aff"))
    draw.rectangle((10, 0, 12, 1), fill=rgba("#4fa8d1ff"), outline=rgba("#d8ecf1ff"))
    draw.point((22, 4), fill=rgba("#f3da7aff"))
    return image


def prop_incident_flame(variant: int) -> Image.Image:
    image = transparent_tile()
    draw = ImageDraw.Draw(image)
    if variant == 0:
        draw.polygon([(1, 7), (1, 4), (3, 1), (4, 4), (6, 2), (7, 6), (6, 7)], fill=rgba("#d34b35ff"), outline=rgba(OUTLINE))
        draw.polygon([(3, 7), (3, 5), (4, 3), (5, 5), (6, 7)], fill=rgba("#f3c94eff"))
    elif variant == 1:
        draw.polygon([(1, 7), (2, 3), (3, 5), (5, 1), (6, 4), (7, 7)], fill=rgba("#d34b35ff"), outline=rgba(OUTLINE))
        draw.polygon([(3, 7), (4, 4), (5, 3), (6, 7)], fill=rgba("#f0a53eff"))
    elif variant == 2:
        draw.polygon([(0, 7), (2, 2), (4, 5), (6, 0), (7, 7)], fill=rgba("#be3d32ff"), outline=rgba(OUTLINE))
        draw.polygon([(2, 7), (3, 4), (4, 6), (5, 3), (6, 7)], fill=rgba("#ffd35aff"))
    else:
        draw.polygon([(1, 7), (1, 5), (2, 3), (4, 4), (5, 1), (7, 5), (7, 7)], fill=rgba("#df5939ff"), outline=rgba(OUTLINE))
        draw.polygon([(3, 7), (3, 5), (5, 4), (6, 7)], fill=rgba("#f5b73fff"))
    return image


def prop_incident_smoke(variant: int) -> Image.Image:
    image = Image.new("RGBA", (8, 16), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    dark, light = "#596568ff", "#87918fff"
    if variant == 0:
        draw.rectangle((3, 9, 5, 14), fill=rgba(dark))
        draw.rectangle((2, 5, 6, 10), fill=rgba(dark), outline=rgba(OUTLINE))
        draw.rectangle((0, 2, 4, 6), fill=rgba(light), outline=rgba(OUTLINE))
    elif variant == 1:
        draw.rectangle((2, 10, 4, 15), fill=rgba(dark))
        draw.rectangle((1, 6, 5, 11), fill=rgba(light), outline=rgba(OUTLINE))
        draw.rectangle((3, 2, 7, 7), fill=rgba(dark), outline=rgba(OUTLINE))
    elif variant == 2:
        draw.rectangle((4, 10, 6, 15), fill=rgba(dark))
        draw.rectangle((2, 6, 7, 11), fill=rgba(dark), outline=rgba(OUTLINE))
        draw.rectangle((0, 1, 5, 6), fill=rgba(light), outline=rgba(OUTLINE))
    else:
        draw.rectangle((1, 11, 3, 15), fill=rgba(light))
        draw.rectangle((0, 7, 5, 12), fill=rgba(light), outline=rgba(OUTLINE))
        draw.rectangle((3, 3, 7, 8), fill=rgba(dark), outline=rgba(OUTLINE))
    return image


def prop_fisher(direction: str, variant: int) -> Image.Image:
    image = prop_walker(direction, WALKER_SHIRTS[variant % len(WALKER_SHIRTS)])
    draw = ImageDraw.Draw(image)
    if direction in "EW":
        side = 7 if direction == "E" else 0
        draw.line((4 if direction == "E" else 3, 4, side, 1), fill=rgba("#b78d55ff"))
        draw.line((side, 1, side, 6), fill=rgba("#c7d4d1ff"))
        draw.point((side, 7), fill=rgba("#d8b64fff"))
    else:
        rod_x = 6 if direction == "N" else 1
        draw.line((4, 4, rod_x, 0 if direction == "N" else 7), fill=rgba("#b78d55ff"))
        draw.point((rod_x, 0 if direction == "N" else 7), fill=rgba("#d8b64fff"))
    return image


def prop_resident(action: str, variant: int) -> Image.Image:
    image = prop_walker("S", WALKER_SHIRTS[variant % len(WALKER_SHIRTS)])
    draw = ImageDraw.Draw(image)
    if action == "reader": draw.rectangle((1, 3, 6, 5), fill=rgba("#d7c993ff"), outline=rgba(OUTLINE))
    elif action == "box": draw.rectangle((4, 3, 7, 6), fill=rgba("#a97846ff"), outline=rgba(OUTLINE))
    elif action == "sweeper": draw.line((5, 3, 7, 7), fill=rgba("#b78d55ff"))
    elif action == "phone": draw.point((5, 2), fill=rgba("#d9e2ddff"))
    elif action == "worker": draw.point((1, 0), fill=rgba("#e0b84fff")); draw.point((6, 4), fill=rgba("#aeb9b8ff"))
    elif action == "wave": draw.line((5, 3, 7, 0), fill=rgba(WALKER_SKIN))
    return image


def prop_fence(vertical: bool) -> Image.Image:
    image = Image.new("RGBA", (8, 16) if vertical else (16, 8), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    if vertical:
        draw.line((3, 0, 3, 15), fill=rgba("#805e3cff")); draw.line((5, 0, 5, 15), fill=rgba("#a57b4cff"))
        for y in (2, 8, 14): draw.rectangle((2, y, 6, min(15, y + 1)), fill=rgba("#b08a58ff"), outline=rgba(OUTLINE))
    else:
        draw.line((0, 3, 15, 3), fill=rgba("#805e3cff")); draw.line((0, 5, 15, 5), fill=rgba("#a57b4cff"))
        for x in (2, 8, 14): draw.rectangle((x, 2, min(15, x + 1), 6), fill=rgba("#b08a58ff"), outline=rgba(OUTLINE))
    return image


def prop_active_marker() -> Image.Image:
    image = Image.new("RGBA", (8, 16), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.line((2, 1, 2, 15), fill=rgba("#d7c7a0ff"))
    draw.polygon([(3, 2), (7, 4), (3, 7)], fill=rgba("#f2c84bff"), outline=rgba(OUTLINE))
    return image


def prop_guardrail(vertical: bool) -> Image.Image:
    image = Image.new("RGBA", (8, 16) if vertical else (16, 8), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    if vertical:
        draw.line((4, 0, 4, 15), fill=rgba("#b9c2c0ff"), width=2)
        for y in (2, 8, 14): draw.line((2, y, 6, y), fill=rgba("#64777cff"))
    else:
        draw.line((0, 4, 15, 4), fill=rgba("#b9c2c0ff"), width=2)
        for x in (2, 8, 14): draw.line((x, 2, x, 6), fill=rgba("#64777cff"))
    return image


def prop_playground() -> Image.Image:
    """Compact 3x2-cell playground with a slide, sandbox and climbing bar."""
    image = Image.new("RGBA", (24, 16), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    # Sand/rubber base stays transparent around the silhouette; the park area
    # supplies the ground tile in the renderer.
    draw.rectangle((1, 9, 9, 14), fill=rgba("#d9b66aff"), outline=rgba(OUTLINE))
    draw.line((12, 4, 12, 14), fill=rgba("#7d8f93ff"), width=2)
    draw.line((20, 4, 20, 14), fill=rgba("#7d8f93ff"), width=2)
    draw.line((12, 4, 20, 4), fill=rgba("#d06355ff"), width=2)
    draw.line((15, 5, 15, 11), fill=rgba("#d9b66aff"))
    draw.line((18, 5, 18, 11), fill=rgba("#d9b66aff"))
    draw.rectangle((14, 11, 19, 13), fill=rgba("#4f8fa8ff"), outline=rgba(OUTLINE))
    draw.polygon([(3, 8), (6, 2), (10, 8)], fill=rgba("#d06355ff"), outline=rgba(OUTLINE))
    draw.line((6, 3, 6, 11), fill=rgba("#d9c7a0ff"))
    return image


def draw_site(draw: ImageDraw.ImageDraw, width: int, height: int) -> None:
    y = height - 5
    draw.rectangle((2, y, width - 3, height - 2), fill=rgba("#806447ff"), outline=rgba(OUTLINE))
    for x in (3, width - 4):
        draw.line((x, y - 3, x, height - 1), fill=rgba("#d1af6aff"))


def draw_frame(draw: ImageDraw.ImageDraw, width: int, top: int, bottom: int) -> None:
    for x in range(3, width - 2, 6): draw.line((x, top, x, bottom), fill=rgba(FRAME), width=1)
    for y in range(top, bottom + 1, 6): draw.line((2, y, width - 3, y), fill=rgba(FRAME), width=1)
    draw.rectangle((2, top, width - 3, bottom), outline=rgba(OUTLINE))


def draw_ferris_wheel_stage(image: Image.Image, spec: HouseSpec, stage: int) -> None:
    draw = ImageDraw.Draw(image)
    width, height = spec.size
    bottom = height - 2
    if stage == 1:
        draw_site(draw, width, height)
        return
    foundation_top = bottom - 9
    draw.rectangle((3, foundation_top, width - 4, bottom), fill=rgba(CONCRETE), outline=rgba(OUTLINE))
    for x in (width // 3, width * 2 // 3):
        draw.rectangle((x - 3, foundation_top - 2, x + 3, bottom), fill=rgba("#76634dff"), outline=rgba(OUTLINE))
    if stage == 2:
        return
    center_x, center_y = width // 2, max(27, height // 2 - 5)
    radius = min(width // 2 - 5, center_y - 3)
    wheel_box = (center_x - radius, center_y - radius, center_x + radius, center_y + radius)
    draw.ellipse(wheel_box, outline=rgba(spec.dark), width=2)
    spokes = ((0, -radius), (radius, 0), (0, radius), (-radius, 0), (radius * 2 // 3, -radius * 2 // 3),
              (radius * 2 // 3, radius * 2 // 3), (-radius * 2 // 3, radius * 2 // 3), (-radius * 2 // 3, -radius * 2 // 3))
    for dx, dy in spokes:
        draw.line((center_x, center_y, center_x + dx, center_y + dy), fill=rgba(spec.dark))
    draw.line((center_x, center_y, width // 3, foundation_top), fill=rgba(spec.wall), width=3)
    draw.line((center_x, center_y, width * 2 // 3, foundation_top), fill=rgba(spec.wall), width=3)
    draw.rectangle((center_x - 2, center_y - 2, center_x + 2, center_y + 2), fill=rgba(spec.accent), outline=rgba(OUTLINE))
    if stage >= 4:
        cabin_points = spokes[::2] if stage == 4 else spokes
        for dx, dy in cabin_points:
            x, y = center_x + dx, center_y + dy
            draw.rectangle((x - 3, y - 2, x + 3, y + 3), fill=rgba(spec.wall), outline=rgba(OUTLINE))
            draw.rectangle((x - 1, y - 1, x + 1, y), fill=rgba(GLASS))
        pavilion_top = bottom - 13
        draw.rectangle((center_x - 8, pavilion_top + 3, center_x + 8, bottom), fill=rgba(spec.wall), outline=rgba(OUTLINE))
        draw.polygon([(center_x - 9, pavilion_top + 3), (center_x, pavilion_top - 2), (center_x + 9, pavilion_top + 3)], fill=rgba(spec.roof), outline=rgba(OUTLINE))
        draw.rectangle((center_x - 2, bottom - 6, center_x + 2, bottom), fill=rgba(spec.accent), outline=rgba(OUTLINE))
    if stage == 4:
        draw_frame(draw, width, max(2, center_y - radius), bottom)


def draw_megatall_stage(image: Image.Image, spec: HouseSpec, stage: int) -> None:
    draw = ImageDraw.Draw(image)
    width, height = spec.size
    bottom = height - 2
    if stage == 1:
        draw_site(draw, width, height)
        return
    draw.rectangle((3, bottom - 11, width - 4, bottom), fill=rgba(CONCRETE), outline=rgba(OUTLINE))
    draw.rectangle((7, bottom - 8, width - 8, bottom - 2), fill=rgba("#76634dff"))
    if stage == 2:
        return
    if stage == 3:
        frame_top = height // 2
        draw_frame(draw, width, frame_top, bottom)
        draw.rectangle((7, bottom - 13, width - 8, bottom), fill=rgba(spec.wall), outline=rgba(OUTLINE))
        return
    tiers = ((4, width - 5, height // 3), (8, width - 9, height // 6), (13, width - 14, 8))
    previous_top = bottom - 12
    for left, right, top in tiers:
        draw.rectangle((left, top, right, previous_top), fill=rgba(spec.wall), outline=rgba(OUTLINE))
        draw.rectangle((right - 4, top + 2, right, previous_top), fill=rgba(spec.dark), outline=rgba(OUTLINE))
        for x in range(left + 3, right - 3, 6):
            draw.line((x, top + 3, x, previous_top - 2), fill=rgba(GLASS), width=2)
        previous_top = top
    draw.rectangle((7, bottom - 13, width - 8, bottom), fill=rgba(spec.wall), outline=rgba(OUTLINE))
    draw.rectangle((width // 2 - 3, bottom - 9, width // 2 + 3, bottom), fill=rgba(spec.accent), outline=rgba(OUTLINE))
    draw.line((width // 2, 2, width // 2, 8), fill=rgba(spec.accent), width=2)
    if stage == 4:
        draw_frame(draw, width, height // 4, bottom)


def draw_monument_stage(image: Image.Image, spec: HouseSpec, stage: int) -> None:
    draw = ImageDraw.Draw(image)
    width, height = spec.size
    bottom = height - 2
    if stage == 1:
        draw_site(draw, width, height)
        return
    pedestal_top = bottom - 13
    draw.rectangle((2, pedestal_top, width - 3, bottom), fill=rgba(CONCRETE), outline=rgba(OUTLINE))
    draw.rectangle((5, pedestal_top - 3, width - 6, pedestal_top), fill=rgba(spec.wall), outline=rgba(OUTLINE))
    if stage == 2:
        return
    stele_left, stele_right = width // 2 - 5, width // 2 + 5
    stele_top = 9
    if stage == 3:
        draw.rectangle((stele_left, stele_top + 12, stele_right, pedestal_top - 1), outline=rgba(OUTLINE))
        for y in range(stele_top + 12, pedestal_top, 7):
            draw.line((stele_left, y, stele_right, y), fill=rgba(FRAME))
        draw.line((width // 2, stele_top + 12, width // 2, pedestal_top), fill=rgba(FRAME), width=2)
        return
    draw.rectangle((stele_left, stele_top, stele_right, pedestal_top), fill=rgba(spec.wall), outline=rgba(OUTLINE))
    draw.rectangle((stele_right - 2, stele_top + 2, stele_right, pedestal_top), fill=rgba(spec.dark))
    draw.rectangle((width // 2 - 2, stele_top + 8, width // 2 + 2, pedestal_top - 5), fill=rgba(spec.accent), outline=rgba(OUTLINE))
    draw.polygon([(width // 2, 1), (width // 2 + 5, 6), (width // 2, 11), (width // 2 - 5, 6)], fill=rgba(spec.accent), outline=rgba(OUTLINE))
    if stage == 4:
        draw_frame(draw, width, max(1, stele_top - 1), bottom)


def draw_landmark_stage(image: Image.Image, spec: HouseSpec, stage: int) -> bool:
    if spec.style == "landmark-ferris-wheel":
        draw_ferris_wheel_stage(image, spec, stage)
    elif spec.style == "landmark-megatall":
        draw_megatall_stage(image, spec, stage)
    elif spec.style == "landmark-monument":
        draw_monument_stage(image, spec, stage)
    elif spec.style.startswith("landmark-series-"):
        draw_landmark_series_stage(image, spec, stage)
    else:
        return False
    return True


def draw_landmark_series_stage(image: Image.Image, spec: HouseSpec, stage: int) -> None:
    """Draw ten readable landmark silhouettes while keeping the five-stage contract."""
    draw = ImageDraw.Draw(image)
    width, height = spec.size
    variant = int(spec.style.rsplit("-", 1)[-1])
    bottom = height - 2
    if stage == 1:
        draw_site(draw, width, height)
        return
    if stage == 2:
        draw.rectangle((2, bottom - 10, width - 3, bottom), fill=rgba(CONCRETE), outline=rgba(OUTLINE))
        draw.rectangle((6, bottom - 7, width - 7, bottom - 2), fill=rgba("#76634dff"))
        return
    if stage == 3:
        draw_frame(draw, width, max(4, height // 4), bottom)
        return

    # Each variant has an unmistakable macro-silhouette; details remain on the
    # same 1 px grid and use the shared pack palette.
    if variant == 0:  # stadium bowl
        draw.ellipse((2, height // 3, width - 3, bottom), fill=rgba(spec.wall), outline=rgba(OUTLINE), width=2)
        draw.ellipse((10, height // 3 + 7, width - 11, bottom - 7), fill=rgba("#4b8250ff"), outline=rgba(spec.dark))
        for x in range(8, width - 8, 10): draw.line((x, height // 3 + 2, x - 2, bottom - 3), fill=rgba(spec.accent))
    elif variant == 1:  # observatory
        draw.rectangle((5, height // 2, width - 6, bottom), fill=rgba(spec.wall), outline=rgba(OUTLINE))
        draw.pieslice((8, 5, width - 9, height - 8), 180, 360, fill=rgba(spec.roof), outline=rgba(OUTLINE))
        draw.line((width // 2, 6, width // 2 + 8, 1), fill=rgba(spec.accent), width=2)
    elif variant == 2:  # concert hall
        draw.polygon([(2, bottom), (8, height // 2), (width // 2, 5), (width - 8, height // 2), (width - 3, bottom)], fill=rgba(spec.wall), outline=rgba(OUTLINE))
        draw.polygon([(8, height // 2), (width // 2, 5), (width - 13, height // 2 + 7)], fill=rgba(spec.roof), outline=rgba(OUTLINE))
        draw.rectangle((width // 2 - 8, bottom - 12, width // 2 + 8, bottom), fill=rgba(GLASS), outline=rgba(OUTLINE))
    elif variant == 3:  # aquarium wave
        draw.rectangle((3, height // 2, width - 4, bottom), fill=rgba(GLASS), outline=rgba(OUTLINE))
        points = [(2, height // 2 + (i % 2) * 5) for i in range(0, width, 8)] + [(width - 3, height // 2 + 4)]
        draw.line(points, fill=rgba(spec.roof), width=4)
        for x in range(10, width - 8, 12): draw.ellipse((x, bottom - 13, x + 4, bottom - 10), outline=rgba(spec.accent))
    elif variant == 4:  # botanical dome
        draw.rectangle((3, bottom - 9, width - 4, bottom), fill=rgba(spec.wall), outline=rgba(OUTLINE))
        draw.pieslice((4, 3, width - 5, bottom + 9), 180, 360, fill=rgba("#78b6a7ff"), outline=rgba(OUTLINE))
        for x in range(9, width - 8, 8): draw.line((x, height // 2, width // 2, 5), fill=rgba(spec.dark))
    elif variant == 5:  # space center with rocket
        draw.rectangle((2, bottom - 18, width - 3, bottom), fill=rgba(spec.wall), outline=rgba(OUTLINE))
        cx = width // 2
        draw.polygon([(cx, 3), (cx - 5, 14), (cx - 5, bottom - 13), (cx + 5, bottom - 13), (cx + 5, 14)], fill=rgba("#d8dfdcff"), outline=rgba(OUTLINE))
        draw.polygon([(cx - 5, bottom - 20), (cx - 10, bottom - 12), (cx - 5, bottom - 12)], fill=rgba(spec.accent), outline=rgba(OUTLINE))
        draw.polygon([(cx + 5, bottom - 20), (cx + 10, bottom - 12), (cx + 5, bottom - 12)], fill=rgba(spec.accent), outline=rgba(OUTLINE))
    elif variant == 6:  # grand station
        draw.rectangle((2, height // 2, width - 3, bottom), fill=rgba(spec.wall), outline=rgba(OUTLINE))
        draw.polygon([(1, height // 2), (width // 2, height // 3), (width - 2, height // 2)], fill=rgba(spec.roof), outline=rgba(OUTLINE))
        draw.rectangle((width // 2 - 6, 5, width // 2 + 6, bottom), fill=rgba(spec.wall), outline=rgba(OUTLINE))
        draw.ellipse((width // 2 - 3, 9, width // 2 + 3, 15), fill=rgba(spec.accent), outline=rgba(OUTLINE))
    elif variant == 7:  # civic arch
        draw.rectangle((5, 12, width - 6, bottom), fill=rgba(spec.wall), outline=rgba(OUTLINE))
        draw.rectangle((width // 2 - 7, bottom - 23, width // 2 + 7, bottom), fill=(0, 0, 0, 0), outline=rgba(OUTLINE))
        draw.polygon([(3, 13), (width // 2, 4), (width - 4, 13)], fill=rgba(spec.roof), outline=rgba(OUTLINE))
    elif variant == 8:  # lighthouse
        cx = width // 2
        draw.polygon([(cx - 8, bottom), (cx - 5, 14), (cx + 5, 14), (cx + 8, bottom)], fill=rgba(spec.wall), outline=rgba(OUTLINE))
        for y in range(19, bottom - 5, 10): draw.rectangle((cx - 5, y, cx + 5, y + 3), fill=rgba(spec.accent))
        draw.rectangle((cx - 8, 7, cx + 8, 15), fill=rgba(GLASS), outline=rgba(OUTLINE))
        draw.polygon([(cx - 10, 7), (cx, 2), (cx + 10, 7)], fill=rgba(spec.roof), outline=rgba(OUTLINE))
    else:  # sky tower
        cx = width // 2
        draw.polygon([(cx - 7, bottom), (cx - 3, 25), (cx + 3, 25), (cx + 7, bottom)], fill=rgba(spec.wall), outline=rgba(OUTLINE))
        draw.ellipse((cx - 13, 14, cx + 13, 31), fill=rgba(GLASS), outline=rgba(OUTLINE), width=2)
        draw.line((cx, 14, cx, 1), fill=rgba(spec.accent), width=2)
    if stage == 4:
        draw_frame(draw, width, max(2, height // 5), bottom)


def draw_tower(image: Image.Image, spec: HouseSpec, scaffold: bool) -> None:
    draw = ImageDraw.Draw(image)
    width, height = spec.size
    bottom = height - 2
    signature = sum((index + 1) * ord(char) for index, char in enumerate(spec.key))
    tier_count = 2 + signature % 3
    top = max(4, height // 9)
    base_left, base_right = 2, width - 3
    draw.rectangle((base_left, bottom - 12, base_right, bottom), fill=rgba(spec.wall), outline=rgba(OUTLINE))
    draw.rectangle((width // 2 - 4, bottom - 8, width // 2 + 4, bottom), fill=rgba(spec.accent), outline=rgba(OUTLINE))
    tier_height = max(8, (bottom - 12 - top) // tier_count)
    current_bottom = bottom - 12
    for tier in range(tier_count):
        inset = 3 + tier * (2 + signature % 2)
        left, right = inset, width - inset - 1
        tier_top = top if tier == tier_count - 1 else max(top, current_bottom - tier_height)
        draw.rectangle((left, tier_top, right, current_bottom), fill=rgba(spec.wall), outline=rgba(OUTLINE))
        draw.rectangle((right - 3, tier_top + 2, right, current_bottom), fill=rgba(spec.dark), outline=rgba(OUTLINE))
        for x in range(left + 3, right - 3, 6):
            draw.line((x, tier_top + 3, x, current_bottom - 2), fill=rgba(GLASS), width=2)
        current_bottom = tier_top
    if "residential" in spec.key:
        for y in range(top + 7, bottom - 16, 8):
            draw.line((3, y, width - 5, y), fill=rgba(spec.accent))
    elif "hotel" in spec.key:
        draw.rectangle((width // 2 - 8, bottom - 14, width // 2 + 8, bottom - 11), fill=rgba(spec.roof), outline=rgba(OUTLINE))
    elif "medical" in spec.key:
        draw.rectangle((width // 2 - 1, max(1, top - 4), width // 2 + 1, top + 2), fill=rgba(spec.accent), outline=rgba(OUTLINE))
        draw.rectangle((width // 2 - 4, max(2, top - 2), width // 2 + 4, top), fill=rgba(spec.accent))
    elif "luxury" in spec.key:
        for x in (5, width - 10):
            draw.rectangle((x, top + 12, x + 4, top + 15), fill=rgba("#6b965aff"), outline=rgba(OUTLINE))
    elif "sustainable" in spec.key:
        draw.rectangle((4, top + 5, 6, bottom - 15), fill=rgba("#5f8e51ff"), outline=rgba(OUTLINE))
        draw.rectangle((width - 8, top + 9, width - 6, bottom - 19), fill=rgba("#79a75fff"), outline=rgba(OUTLINE))
    elif "office" in spec.key:
        draw.rectangle((width // 2 - 5, max(1, top - 3), width // 2 + 5, top), fill=rgba(spec.roof), outline=rgba(OUTLINE))
    if scaffold:
        draw_frame(draw, width, max(2, top - 1), bottom)


def draw_civic_building(image: Image.Image, spec: HouseSpec, scaffold: bool) -> None:
    draw = ImageDraw.Draw(image)
    width, height = spec.size
    bottom = height - 2
    signature = sum((index + 1) * ord(char) for index, char in enumerate(spec.key))
    top = max(5, height // 4)
    monumental = spec.style == "civic-monumental"
    industrial = spec.style == "industrial"
    if monumental:
        draw.rectangle((3, top + 7, width - 4, bottom), fill=rgba(spec.wall), outline=rgba(OUTLINE))
        draw.polygon([(2, top + 7), (width // 2, top), (width - 3, top + 7)], fill=rgba(spec.roof), outline=rgba(OUTLINE))
        draw.rectangle((5, bottom - 4, width - 6, bottom), fill=rgba(CONCRETE), outline=rgba(OUTLINE))
        for x in range(8, width - 8, max(6, width // 6)):
            draw.rectangle((x, top + 10, x + 2, bottom - 5), fill=rgba("#d8d2bdff"), outline=rgba(spec.dark))
    elif industrial:
        draw.rectangle((2, top + 4, width - 3, bottom), fill=rgba(spec.wall), outline=rgba(OUTLINE))
        draw.polygon([(1, top + 5), (width // 3, top), (width * 2 // 3, top + 5), (width - 3, top + 1), (width - 2, top + 6)], fill=rgba(spec.roof), outline=rgba(OUTLINE))
        for x in range(5, width - 8, 10):
            draw.rectangle((x, bottom - 9, x + 6, bottom), fill=rgba(spec.dark), outline=rgba(OUTLINE))
    else:
        wing = 5 + signature % 4
        draw.rectangle((2, top + wing, width - 3, bottom), fill=rgba(spec.wall), outline=rgba(OUTLINE))
        draw.rectangle((width // 3, top, width * 2 // 3, bottom), fill=rgba(spec.wall), outline=rgba(OUTLINE))
        draw.rectangle((1, top + wing - 2, width - 2, top + wing + 1), fill=rgba(spec.roof), outline=rgba(OUTLINE))
        for x in range(5, width - 7, 8):
            draw.rectangle((x, top + wing + 4, x + 3, top + wing + 8), fill=rgba(GLASS), outline=rgba(spec.dark))
    door_x = width // 2 - 3
    draw.rectangle((door_x, bottom - 8, door_x + 6, bottom), fill=rgba(spec.accent), outline=rgba(OUTLINE))
    if "hospital" in spec.key:
        draw.rectangle((width // 2 - 1, max(1, top - 5), width // 2 + 1, top + 1), fill=rgba("#c9524aff"), outline=rgba(OUTLINE))
        draw.rectangle((width // 2 - 4, max(2, top - 3), width // 2 + 4, top - 1), fill=rgba("#c9524aff"))
    elif "university" in spec.key:
        draw.rectangle((2, top + 1, 12, bottom - 5), fill=rgba(spec.wall), outline=rgba(OUTLINE))
        draw.rectangle((width - 13, top + 1, width - 3, bottom - 5), fill=rgba(spec.wall), outline=rgba(OUTLINE))
    elif "aquatic" in spec.key:
        draw.rectangle((7, top + 2, width - 8, top + 6), fill=rgba(GLASS), outline=rgba(OUTLINE))
    elif "transport" in spec.key:
        draw.rectangle((4, bottom - 11, width - 5, bottom - 8), fill=rgba(spec.roof), outline=rgba(OUTLINE))
    elif "power" in spec.key:
        for x in (8, width - 12):
            draw.line((x, top - 4, x, top + 5), fill=rgba(spec.accent), width=2)
    elif "embassy" in spec.key:
        draw.line((width - 7, top - 6, width - 7, top + 7), fill=rgba(spec.dark))
        draw.rectangle((width - 6, top - 5, width - 2, top - 2), fill=rgba(spec.accent), outline=rgba(OUTLINE))
    elif "memorial" in spec.key:
        draw.rectangle((width // 2 - 2, max(1, top - 6), width // 2 + 2, top + 1), fill=rgba(spec.accent), outline=rgba(OUTLINE))
    if scaffold:
        draw_frame(draw, width, max(2, top - 6), bottom)


def draw_commercial_building(image: Image.Image, spec: HouseSpec, scaffold: bool) -> None:
    draw = ImageDraw.Draw(image)
    width, height = spec.size
    bottom = height - 2
    signature = sum((index + 1) * ord(char) for index, char in enumerate(spec.key))
    top = max(4, height // 4 + signature % 3)
    if spec.style == "market":
        for index, x in enumerate(range(2, width - 8, 10)):
            draw.polygon([(x, top + 4), (x + 4, top), (x + 8, top + 4)], fill=rgba(spec.roof if index % 2 else spec.accent), outline=rgba(OUTLINE))
            draw.rectangle((x, top + 4, x + 8, bottom), fill=rgba(spec.wall), outline=rgba(OUTLINE))
    elif spec.style == "warehouse":
        draw.rectangle((2, top + 3, width - 3, bottom), fill=rgba(spec.wall), outline=rgba(OUTLINE))
        draw.polygon([(1, top + 4), (width // 2, top), (width - 2, top + 4)], fill=rgba(spec.roof), outline=rgba(OUTLINE))
        draw.rectangle((width // 2 - 7, bottom - 10, width // 2 + 7, bottom), fill=rgba(spec.dark), outline=rgba(OUTLINE))
    else:
        draw.rectangle((2, top + 4, width - 3, bottom), fill=rgba(spec.wall), outline=rgba(OUTLINE))
        draw.rectangle((1, top, width - 2, top + 4), fill=rgba(spec.roof), outline=rgba(OUTLINE))
        awning_width = 8 + (signature % 3) * 4
        awning_left = 3 + signature % max(1, width - awning_width - 5)
        draw.rectangle((awning_left, top + 5, min(width - 4, awning_left + awning_width), top + 7), fill=rgba(spec.accent), outline=rgba(OUTLINE))
        for x in range(4, width - 8, 9):
            draw.rectangle((x, top + 9, x + 5, bottom - 4), fill=rgba(GLASS), outline=rgba(spec.dark))
        door_x = width - 8 if signature % 2 else width // 2 - 2
        draw.rectangle((door_x, bottom - 7, door_x + 4, bottom), fill=rgba(spec.accent), outline=rgba(OUTLINE))
        if "hotel" in spec.key:
            draw.line((3, top - 5, 3, top + 4), fill=rgba(spec.dark))
            draw.rectangle((4, top - 5, 8, top - 2), fill=rgba(spec.accent), outline=rgba(OUTLINE))
        elif "restaurant" in spec.key or "cafe" in spec.key:
            draw.rectangle((3, bottom - 2, 8, bottom), fill=rgba("#805e3cff"), outline=rgba(OUTLINE))
        elif "office" in spec.key:
            draw.rectangle((width // 3, max(1, top - 4), width * 2 // 3, top), fill=rgba(spec.roof), outline=rgba(OUTLINE))
        cue = signature % 5
        if cue == 0:
            draw.rectangle((3, max(1, top - 3), 7, top), fill=rgba(spec.roof), outline=rgba(OUTLINE))
        elif cue == 1:
            draw.polygon([(width // 2 - 4, top), (width // 2, max(1, top - 4)), (width // 2 + 4, top)], fill=rgba(spec.roof), outline=rgba(OUTLINE))
        elif cue == 2:
            draw.line((width - 6, top - 5, width - 6, top), fill=rgba(spec.dark))
            draw.rectangle((width - 5, max(1, top - 5), width - 2, top - 3), fill=rgba(spec.accent), outline=rgba(OUTLINE))
        elif cue == 3:
            cue_x = 4 + signature % max(1, width - 10)
            draw.rectangle((cue_x, max(1, top - 5), cue_x + 2, top), fill=rgba(spec.dark), outline=rgba(OUTLINE))
        else:
            draw.rectangle((4, max(1, top - 2), 7, top), fill=rgba(spec.roof), outline=rgba(OUTLINE))
            draw.rectangle((width - 9, max(1, top - 4), width - 5, top), fill=rgba(spec.roof), outline=rgba(OUTLINE))
    if scaffold:
        draw_frame(draw, width, max(2, top - 4), bottom)


def draw_gas_station(image: Image.Image, spec: HouseSpec, scaffold: bool) -> None:
    """Draw a fuel station using the same visual grammar as the houses.

    The shop is a compact building with a roof plane, front wall and shaded
    right wall.  The canopy, pumps and price pylon make the service role
    readable at native scale without relying on text or runtime labels.
    """
    draw = ImageDraw.Draw(image)
    width, height = spec.size
    bottom = height - 2
    if spec.style == "gas-compact":
        shop_left, shop_top, shop_right = width - 16, 13, width - 2
        canopy_left, canopy_right, canopy_top = 3, shop_left + 2, 8
        pump_centers = (10, 19)
        sign_left, sign_top = 1, 4
    elif spec.style == "gas-highway":
        shop_left, shop_top, shop_right = width - 23, 15, width - 2
        canopy_left, canopy_right, canopy_top = 8, shop_left + 3, 8
        pump_centers = (17, 29, 40)
        sign_left, sign_top = 1, 5
    else:
        shop_left, shop_top, shop_right = width - 19, 13, width - 2
        canopy_left, canopy_right, canopy_top = 5, shop_left + 3, 7
        pump_centers = (13, 24)
        sign_left, sign_top = 1, 4

    # Freestanding price/service pylon. The two-color panel remains legible at
    # 1x and avoids fake unreadable lettering.
    draw.rectangle((sign_left + 2, sign_top + 5, sign_left + 3, bottom), fill=rgba(spec.dark), outline=rgba(OUTLINE))
    draw.rectangle((sign_left, sign_top, sign_left + 6, sign_top + 7), fill=rgba(spec.wall), outline=rgba(OUTLINE))
    draw.rectangle((sign_left + 1, sign_top + 1, sign_left + 5, sign_top + 3), fill=rgba(spec.roof))
    draw.rectangle((sign_left + 1, sign_top + 4, sign_left + 5, sign_top + 5), fill=rgba(spec.accent))

    # Shop: a small but complete building, matching house roof/front/side
    # construction rather than a flat white rectangle.
    side_width = 3
    draw.rectangle((shop_left, shop_top + 4, shop_right - side_width, bottom), fill=rgba(spec.wall), outline=rgba(OUTLINE))
    draw.rectangle((shop_right - side_width, shop_top + 5, shop_right, bottom), fill=rgba(spec.dark), outline=rgba(OUTLINE))
    draw.polygon(
        [(shop_left - 1, shop_top + 2), (shop_right - 3, shop_top + 2), (shop_right, shop_top + 5), (shop_left + 2, shop_top + 5)],
        fill=rgba(spec.roof), outline=rgba(OUTLINE),
    )
    window_right = max(shop_left + 5, shop_right - 9)
    draw.rectangle((shop_left + 2, shop_top + 8, window_right, bottom - 4), fill=rgba(GLASS), outline=rgba(spec.dark))
    draw.line((shop_left + 4, shop_top + 9, shop_left + 4, bottom - 5), fill=rgba("#d9e2ddff"))
    draw.rectangle((shop_right - 8, bottom - 8, shop_right - 4, bottom), fill=rgba(spec.accent), outline=rgba(OUTLINE))

    # Canopy is a shallow roof plane with a dark fascia and a shaded right
    # face. Its overlap with the shop visually joins both parts of the station.
    draw.polygon(
        [(canopy_left, canopy_top + 2), (canopy_right - 3, canopy_top + 2),
         (canopy_right, canopy_top + 5), (canopy_left + 3, canopy_top + 5)],
        fill=rgba(spec.roof), outline=rgba(OUTLINE),
    )
    draw.line((canopy_left + 3, canopy_top + 5, canopy_right, canopy_top + 5), fill=rgba(spec.dark), width=2)
    draw.line((canopy_left + 5, canopy_top + 3, canopy_right - 4, canopy_top + 3), fill=rgba(spec.accent))

    # Columns sit behind the pumps. Pumps have a cyan display, colored body
    # and one-pixel hose, which reads much more clearly than yellow squares.
    for center in pump_centers:
        if center >= shop_left:
            continue
        draw.rectangle((center - 1, canopy_top + 6, center, bottom), fill=rgba("#aeb9b6ff"), outline=rgba(OUTLINE))
        pump_top = bottom - 9
        draw.rectangle((center - 3, pump_top, center + 2, bottom - 1), fill=rgba(spec.accent), outline=rgba(OUTLINE))
        draw.rectangle((center - 2, pump_top + 1, center + 1, pump_top + 3), fill=rgba(GLASS), outline=rgba(spec.dark))
        draw.line((center + 3, pump_top + 2, center + 4, pump_top + 4, center + 4, bottom - 2), fill=rgba(spec.dark))

    if spec.style == "gas-electric":
        draw.rectangle((canopy_left + 4, max(1, canopy_top - 3), canopy_right - 5, canopy_top + 1), fill=rgba("#3f6570ff"), outline=rgba(OUTLINE))
    elif spec.style == "gas-truck":
        draw.rectangle((sign_left + 1, max(1, sign_top - 3), sign_left + 7, sign_top), fill=rgba(spec.roof), outline=rgba(OUTLINE))
    elif spec.style == "gas-cafe":
        draw.polygon([(shop_left + 1, shop_top + 2), (shop_left + 7, max(1, shop_top - 3)), (shop_left + 13, shop_top + 2)], fill=rgba(spec.roof), outline=rgba(OUTLINE))
    elif spec.style == "gas-wash":
        arch_left = max(canopy_left + 5, shop_left - 12)
        draw.rectangle((arch_left, shop_top - 2, shop_left - 2, bottom), outline=rgba(spec.accent), width=2)
        draw.rectangle((arch_left + 2, shop_top - 4, shop_left - 4, shop_top - 1), fill=rgba(spec.roof), outline=rgba(OUTLINE))

    if scaffold:
        draw_frame(draw, width, max(4, canopy_top - 2), bottom)


def draw_series_building(image: Image.Image, spec: HouseSpec, scaffold: bool) -> None:
    """Render the V5 catalog with twenty massing patterns per category.

    The variant controls the silhouette, while category cues keep function
    legible. This is deliberately deterministic: a chunk reload cannot change
    the building or restart it as a different visual variant.
    """
    draw = ImageDraw.Draw(image)
    width, height = spec.size
    variant = int(spec.style.rsplit("-", 1)[-1])
    bottom = height - 2
    top = max(3, height // (7 if spec.category == "HIGHRISE" else 4))
    body_bottom = bottom

    if spec.category == "HIGHRISE":
        # Twenty tower profiles assembled from a small number of crisp volumes.
        profiles = (
            [(2, width // 2 - 2, top + 8), (width // 2 + 1, width - 3, top)],
            [(2, width - 3, top + 14), (7, width - 8, top + 5)],
            [(2, width // 2 - 3, top), (width // 2 + 2, width - 3, top + 4)],
            [(6, width - 7, top + 3)],
            [(7, width - 8, top + 8), (10, width - 11, top)],
            [(2, width - 3, bottom - 18), (8, width - 9, top)],
            [(2, width - 3, bottom - 22), (6, width - 7, top + 4)],
            [(3, width - 4, top + 13), (7, width - 8, top + 5), (11, width - 12, top)],
            [(8, width - 9, top), (5, width - 6, top + 9)],
            [(3, width - 4, top + 6)],
            [(2, width - 3, bottom - 17), (7, width - 8, top)],
            [(2, width - 3, bottom - 20), (4, width - 10, top), (width - 9, width - 4, top + 12)],
            [(8, width - 9, top)],
            [(7, width - 8, top + 7), (3, width - 4, top + 13)],
            [(10, width - 11, top)],
            [(3, width - 12, top + 8), (9, width - 4, top)],
            [(7, width - 8, top + 8), (11, width - 12, top)],
            [(2, width // 2 - 2, top + 12), (width // 2 + 1, width - 3, top + 5)],
            [(2, width - 3, bottom - 18), (5, width - 6, top + 4)],
            [(4, width - 5, top + 5), (8, width - 9, top)],
        )
        for index, (left, right, volume_top) in enumerate(profiles[variant]):
            draw.rectangle((left, volume_top, right, body_bottom), fill=rgba(spec.wall), outline=rgba(OUTLINE))
            draw.rectangle((max(left, right - 3), volume_top + 2, right, body_bottom), fill=rgba(spec.dark))
            for x in range(left + 3, right - 3, 6):
                draw.line((x, volume_top + 3, x, body_bottom - 3), fill=rgba(GLASS), width=2)
            if variant in {7, 15, 19} and index:
                draw.rectangle((left, volume_top, right, volume_top + 2), fill=rgba("#5d8b55ff"), outline=rgba(OUTLINE))
        if variant == 2:
            draw.rectangle((width // 2 - 7, top + 22, width // 2 + 7, top + 27), fill=rgba(GLASS), outline=rgba(OUTLINE))
        elif variant in {4, 8, 16}:
            draw.polygon([(width // 2, max(1, top - 5)), (width - 8, top + 5), (8, top + 5)], fill=rgba(spec.roof), outline=rgba(OUTLINE))
        elif variant == 13:
            draw.ellipse((width // 2 - 8, top, width // 2 + 8, top + 7), fill=rgba(spec.accent), outline=rgba(OUTLINE))
        elif variant == 18:
            draw.rectangle((3, bottom - 20, width - 4, bottom - 16), fill=rgba(spec.accent), outline=rgba(OUTLINE))
        if variant == 14:
            draw.rectangle((2, bottom - 15, width - 3, bottom), fill=rgba(spec.wall), outline=rgba(OUTLINE))
            draw.line((3, bottom - 14, width - 4, bottom - 14), fill=rgba(spec.accent), width=2)
    else:
        # Low-rise variants: offset wings, courtyards, gables and arcades avoid
        # the previous repeated three-straight-roads / identical-box rhythm.
        rise = 2 + (variant % 4) * 2
        body_top = min(bottom - 12, top + rise)
        if variant in {1, 2, 3, 12, 13}:
            draw.rectangle((2, body_top + 4, width - 3, bottom), fill=rgba(spec.wall), outline=rgba(OUTLINE))
            peaks = 2 if width < 48 else 3
            segment = max(8, (width - 4) // peaks)
            for i in range(peaks):
                left = 2 + i * segment
                right = min(width - 3, left + segment)
                draw.polygon([(left, body_top + 4), ((left + right) // 2, top), (right, body_top + 4)], fill=rgba(spec.roof), outline=rgba(OUTLINE))
        elif variant in {8, 11, 15}:
            draw.rectangle((2, body_top, width - 3, bottom), fill=rgba(spec.wall), outline=rgba(OUTLINE))
            cut_left = width // 3
            cut_right = width * 2 // 3
            draw.rectangle((cut_left, body_top + 9, cut_right, bottom), fill=(0, 0, 0, 0), outline=rgba(spec.dark))
            draw.rectangle((1, body_top - 2, width - 2, body_top + 2), fill=rgba(spec.roof), outline=rgba(OUTLINE))
        elif variant in {6, 7, 10, 16, 18}:
            draw.rectangle((2, body_top + 6, width - 3, bottom), fill=rgba(spec.wall), outline=rgba(OUTLINE))
            draw.rectangle((width // 3, body_top, width * 2 // 3, bottom), fill=rgba(spec.wall), outline=rgba(OUTLINE))
            draw.rectangle((1, body_top + 3, width - 2, body_top + 7), fill=rgba(spec.roof), outline=rgba(OUTLINE))
        else:
            draw.rectangle((2, body_top, width - 3, bottom), fill=rgba(spec.wall), outline=rgba(OUTLINE))
            offset = 4 + (variant * 5) % max(5, width // 2)
            draw.rectangle((offset, max(2, body_top - 5), width - 4, body_top + 3), fill=rgba(spec.roof), outline=rgba(OUTLINE))
        # Shared windows are offset by variant, preventing palette-only copies.
        window_start = 4 + variant % 3
        for x in range(window_start, width - 7, 8):
            for y in range(body_top + 6, bottom - 5, 8):
                draw.rectangle((x, y, x + 3, y + 3), fill=rgba(GLASS), outline=rgba(spec.dark))
        door_x = 4 + (variant * 7) % max(5, width - 11)
        draw.rectangle((door_x, bottom - 7, door_x + 5, bottom), fill=rgba(spec.accent), outline=rgba(OUTLINE))
        if spec.category == "COMMERCIAL":
            draw.line((3, bottom - 12, width - 5, bottom - 12), fill=rgba(spec.accent), width=2)
            if variant in {2, 10, 15, 18}:
                for x in range(4, width - 8, 10):
                    draw.polygon([(x, body_top + 3), (x + 4, max(1, body_top - 2)), (x + 8, body_top + 3)], fill=rgba(spec.accent), outline=rgba(OUTLINE))
        elif spec.category == "CIVIC":
            draw.rectangle((width // 2 - 6, max(1, body_top - 4), width // 2 + 6, body_top), fill=rgba(spec.roof), outline=rgba(OUTLINE))
            if any(token in spec.key for token in ("health", "emergency", "fire")):
                draw.rectangle((width // 2 - 1, max(1, top - 6), width // 2 + 1, top), fill=rgba("#c9524aff"))
                draw.rectangle((width // 2 - 4, max(2, top - 4), width // 2 + 4, top - 2), fill=rgba("#c9524aff"))
        elif variant in {9, 16}:
            draw.rectangle((4, max(1, body_top - 3), width - 8, body_top), fill=rgba("#5f8e51ff"), outline=rgba(OUTLINE))
        elif variant == 17:
            for x in range(5, width - 4, 9): draw.line((x, bottom - 3, x, bottom), fill=rgba(FRAME), width=2)
        # A rooftop signature changes both the outline and identity. The exact
        # cue depends on variant/category, so same-size facilities do not become
        # recoloured clones in the contact sheet.
        cue_x = 3 + (variant * 11 + len(spec.category)) % max(4, width - 10)
        cue_height = 2 + variant % 4
        if variant % 3 == 0:
            draw.rectangle((cue_x, max(1, body_top - cue_height), cue_x + 3, body_top), fill=rgba(spec.dark), outline=rgba(OUTLINE))
        elif variant % 3 == 1:
            draw.polygon([(cue_x, body_top), (cue_x + 3, max(1, body_top - cue_height)), (cue_x + 6, body_top)], fill=rgba(spec.roof), outline=rgba(OUTLINE))
        else:
            draw.line((cue_x + 2, max(1, body_top - cue_height - 2), cue_x + 2, body_top), fill=rgba(spec.accent), width=2)
        if spec.key == "commercial-marina-office":
            draw.line((width - 3, max(1, body_top - 8), width - 3, body_top + 2), fill=rgba(spec.dark))
            draw.polygon([(width - 2, body_top - 8), (width - 2, body_top - 4), (width + 2, body_top - 6)], fill=rgba(spec.accent))
        elif spec.key == "house-canalside-terrace":
            draw.rectangle((1, max(1, body_top - 7), 4, body_top + 1), fill=rgba(spec.dark), outline=rgba(OUTLINE))
    if scaffold:
        draw_frame(draw, width, max(2, top - 2), bottom)
        # Keep stage 4 visibly unfinished even on compact, already outlined
        # buildings where a scaffold could otherwise overlap opaque pixels.
        for x in (0, width - 1):
            draw.line((x, 1, x, bottom), fill=rgba(SCAFFOLD))
        draw.line((0, 2, width - 1, 2), fill=rgba(SCAFFOLD))


def draw_finished_house(image: Image.Image, spec: HouseSpec, scaffold: bool) -> None:
    draw = ImageDraw.Draw(image)
    width, height = spec.size
    bottom = height - 2
    top = max(4, height // 4)
    if spec.style.startswith("series-"):
        draw_series_building(image, spec, scaffold)
        return
    if spec.style.startswith("gas-"):
        draw_gas_station(image, spec, scaffold)
        return
    if spec.style.startswith("tower-"):
        draw_tower(image, spec, scaffold)
        return
    if spec.style in {"civic-monumental", "civic-modern", "industrial"}:
        draw_civic_building(image, spec, scaffold)
        return
    if spec.style.startswith("shop-") or spec.style in {"market", "warehouse", "small-office", "small-hotel"}:
        draw_commercial_building(image, spec, scaffold)
        return
    body_top = top + (5 if spec.style in {"gabled", "duplex"} else 2)
    draw.rectangle((2, body_top, width - 4, bottom), fill=rgba(spec.wall), outline=rgba(OUTLINE))
    draw.rectangle((width - 5, body_top + 2, width - 2, bottom), fill=rgba(spec.dark), outline=rgba(OUTLINE))
    if spec.style in {"gabled", "duplex"}:
        draw.polygon([(1, body_top + 2), (width // 2, top), (width - 3, body_top + 2)], fill=rgba(spec.roof), outline=rgba(OUTLINE))
    else:
        draw.rectangle((1, top, width - 3, body_top + 2), fill=rgba(spec.roof), outline=rgba(OUTLINE))
    if spec.style == "courtyard":
        draw.rectangle((width // 2 - 5, body_top + 8, width // 2 + 5, bottom), fill=rgba("#5d804aff"), outline=rgba(spec.dark))
    columns = max(2, spec.footprint[0] - 1)
    for column in range(columns):
        x = 4 + column * max(4, (width - 9) // max(1, columns - 1))
        if x > width - 7:
            continue
        for y in range(body_top + 4, bottom - 5, 7):
            draw.rectangle((x, y, min(width - 5, x + 2), y + 3), fill=rgba(GLASS), outline=rgba(spec.dark))
    door_x = width // 2 - 2
    draw.rectangle((door_x, bottom - 7, door_x + 4, bottom), fill=rgba(spec.accent), outline=rgba(OUTLINE))
    if spec.style == "row":
        for index, x in enumerate(range(8, width - 3, 8)):
            draw.line((x, body_top, x, bottom), fill=rgba(spec.dark))
            if index % 2 == 0:
                draw.rectangle((max(2, x - 6), max(2, top - 2), x - 1, top), fill=rgba(spec.roof), outline=rgba(OUTLINE))
    if spec.style == "modern":
        draw.rectangle((3, body_top + 4, width // 2, body_top + 8), fill=rgba(spec.accent), outline=rgba(OUTLINE))
    if spec.category == "HOUSE":
        signature = sum((index + 1) * ord(char) for index, char in enumerate(spec.key))
        if spec.style in {"colonial", "craftsman", "suburban-brick", "duplex-brick"}:
            draw.polygon([(2, body_top + 2), (width // 2, max(2, top - 4)), (width - 4, body_top + 2)], fill=rgba(spec.roof), outline=rgba(OUTLINE))
        if spec.style == "split-level":
            draw.rectangle((width // 2, max(2, top - 4), width - 3, body_top + 2), fill=rgba(spec.roof), outline=rgba(OUTLINE))
        elif spec.style in {"townhouse-brick", "townhouse-stone", "rowhouse-corner"}:
            for index, x in enumerate(range(2, width - 4, 8)):
                rise = 2 + (index % 2) * 2
                draw.rectangle((x, max(2, top - rise), min(width - 3, x + 7), top), fill=rgba(spec.roof), outline=rgba(OUTLINE))
                draw.line((x + 7, top, x + 7, bottom), fill=rgba(spec.dark))
        elif spec.style in {"garden-apartment", "courtyard-block"}:
            courtyard_width = max(6, width // 3)
            draw.rectangle((width // 2 - courtyard_width // 2, body_top + 7, width // 2 + courtyard_width // 2, bottom), fill=(0, 0, 0, 0))
            draw.rectangle((width // 2 - courtyard_width // 2, body_top + 7, width // 2 + courtyard_width // 2, bottom), outline=rgba(spec.dark))
        elif spec.style == "modern-villa":
            draw.rectangle((width // 2, max(2, top - 3), width - 4, top + 1), fill=rgba(spec.wall), outline=rgba(OUTLINE))
        elif spec.style == "studio-loft":
            for x in range(2, width - 5, 7):
                draw.polygon([(x, top), (x + 3, max(2, top - 3)), (x + 6, top)], fill=rgba(spec.roof), outline=rgba(OUTLINE))
        elif spec.style == "apartment-walkup":
            draw.line((width - 9, body_top + 4, width - 3, bottom - 3), fill=rgba(spec.accent), width=2)
            for y in range(body_top + 6, bottom - 2, 6):
                draw.line((width - 10, y, width - 4, y), fill=rgba(spec.accent))
        elif spec.style == "eco-cottage":
            draw.rectangle((4, max(2, top - 2), width - 8, top + 1), fill=rgba("#557b4aff"), outline=rgba(OUTLINE))
            draw.rectangle((width - 9, max(1, top - 5), width - 6, top), fill=rgba(spec.dark), outline=rgba(OUTLINE))
        elif spec.style == "ranch":
            draw.rectangle((3, max(2, top - 2), width - 4, top), fill=rgba(spec.roof), outline=rgba(OUTLINE))
        # A restrained chimney/skylight position makes same-size houses keep
        # distinct silhouettes without turning them into noisy palette swaps.
        cue_x = 3 + signature % max(1, width - 9)
        cue_height = 2 + signature % 3
        draw.rectangle((cue_x, max(1, top - cue_height), cue_x + 2, top), fill=rgba(spec.dark), outline=rgba(OUTLINE))
    if spec.style == "mixed-use":
        ground_top = max(body_top + 3, bottom - 11)
        draw.rectangle((2, ground_top, width - 4, bottom), fill=rgba("#d8c9a8ff"), outline=rgba(OUTLINE))
        for x in range(4, width - 7, 8):
            draw.rectangle((x, ground_top + 3, x + 5, bottom - 2), fill=rgba(GLASS), outline=rgba(spec.dark))
        draw.line((2, ground_top, width - 4, ground_top), fill=rgba(spec.accent), width=2)
    # Service buildings must keep a readable, non-palette-only identity at 1x.
    if "fire-station" in spec.key:
        tower_right = min(width - 4, 11)
        draw.rectangle((3, max(2, top - 5), tower_right, bottom), fill=rgba(spec.wall), outline=rgba(OUTLINE))
        draw.rectangle((4, max(1, top - 7), tower_right - 1, max(2, top - 5)), fill=rgba(spec.roof), outline=rgba(OUTLINE))
    elif "police" in spec.key:
        draw.rectangle((width // 2 - 3, max(1, top - 3), width // 2 + 3, top), fill=rgba(spec.roof), outline=rgba(OUTLINE))
    elif "clinic" in spec.key:
        draw.rectangle((width // 2 - 1, max(1, top - 4), width // 2 + 1, top), fill=rgba(spec.accent), outline=rgba(OUTLINE))
        draw.rectangle((width // 2 - 3, max(2, top - 3), width // 2 + 3, top - 1), fill=rgba(spec.accent))
    elif "library" in spec.key:
        draw.polygon([(width // 2 - 6, top), (width // 2, max(1, top - 4)), (width // 2 + 6, top)], fill=rgba(spec.roof), outline=rgba(OUTLINE))
    if scaffold:
        for x in (0, width - 2): draw.line((x, top - 1, x, bottom), fill=rgba(SCAFFOLD))
        for y in range(top + 2, bottom, 7): draw.line((0, y, width - 1, y), fill=rgba(SCAFFOLD))


def building_stage(spec: HouseSpec, stage: int) -> Image.Image:
    image = Image.new("RGBA", spec.size, (0, 0, 0, 0))
    if draw_landmark_stage(image, spec, stage):
        return image
    draw = ImageDraw.Draw(image)
    width, height = spec.size
    if stage == 1:
        draw_site(draw, width, height)
    elif stage == 2:
        draw.rectangle((2, height - 10, width - 3, height - 2), fill=rgba(CONCRETE), outline=rgba(OUTLINE))
        draw.rectangle((5, height - 7, width - 6, height - 3), fill=rgba("#76634dff"))
    elif stage == 3:
        draw_frame(draw, width, max(6, height // 3), height - 2)
    else:
        draw_finished_house(image, spec, scaffold=stage == 4)
    return image


def copy_v3_runtime() -> None:
    for directory in ("buildings", "props", "tiles", "vehicles"):
        shutil.copytree(V3 / directory, RUNTIME / directory, dirs_exist_ok=True)
    for color, palette in CAR_PALETTES.items():
        topdown_vertical_car(palette).save(RUNTIME / "vehicles" / f"car-{color}-vertical.png", optimize=True)
    (RUNTIME / "tiles" / "curb.png").unlink(missing_ok=True)
    classic_station = HouseSpec(
        key="commercial-gas-station", label="Заправка", size=(48, 32), footprint=(6, 3),
        wall="#d9d2bdff", dark="#657277ff", roof="#3f7f72ff", accent="#e2be4fff",
        style="gas-standard", rarity="UNCOMMON", category="COMMERCIAL",
    )
    destination = RUNTIME / "buildings" / "commercial" / classic_station.key
    for stage in range(1, 6): building_stage(classic_station, stage).save(destination / f"stage-{stage}.png", optimize=True)


def building_metadata(key: str, raw: dict) -> dict:
    category = raw["category"]
    footprint = raw["footprintCells"]
    area = footprint[0] * footprint[1]
    if area <= 6: estimates = [1, 2]
    elif area <= 12: estimates = [2, 3]
    elif area <= 20: estimates = [3, 6]
    else: estimates = [6]
    platform = "YARD" if category == "HOUSE" else "STONE"
    rule_ids = ["STANDARD"]
    tags = [category.lower()]
    max_per_city = None
    max_per_district = None
    service_role = None
    if category == "HIGHRISE":
        platform = "STONE"; tags += ["dense", "residential", "new-build"]
    elif category == "COMMERCIAL":
        tags += ["commercial"]
    elif category == "CIVIC":
        platform = "SERVICE"; tags += ["service", "civic"]; rule_ids = ["UNIQUE_SERVICE"]; max_per_district = 1
    if any(token in key for token in ("gas-station", "service-plaza", "parking", "auto-repair", "warehouse")):
        platform = "ASPHALT"; rule_ids.append("REQUIRES_COLLECTOR")
    if "parking" in key:
        max_per_city = 1; max_per_district = 1; service_role = "parking-service"; rule_ids.append("UNIQUE_SERVICE")
    if "gas-station" in key or "service-plaza" in key:
        max_per_city = 1; max_per_district = 1; service_role = "fuel-service"; rule_ids.append("UNIQUE_SERVICE")
    if any(token in key for token in ("fire", "police", "clinic", "school", "city-hall")):
        max_per_city = 1
    if key in {"highrise-landmark", "civic-bank", "civic-post-office"}: max_per_city = 1
    if key.startswith("landmark-"):
        platform = "STONE"
        estimates = [6]
        max_per_city = 1
        max_per_district = 1
        rule_ids = ["UNIQUE_SERVICE"]
        tags += ["landmark", "unique"]
        if "ferris" in key:
            service_role = "leisure-service"; tags += ["leisure"]
        elif "monument" in key:
            service_role = "culture-service"; tags += ["culture"]
        else:
            service_role = "office-service"; tags += ["office"]
    if "parking" in key: estimates = [1, 2, 3]
    if key == "house-small-apartments": estimates = [1, 2, 3]
    if key in {"house-rowhomes", "house-garden-villa"}: estimates = [2, 3, 6]
    if any(token in key for token in ("cottage", "duplex", "rowhome", "townhouse", "woodland", "private", "suburban")):
        tags += ["residential", "private-residential"]
    if any(token in key for token in ("apartment", "highrise", "tower")):
        tags += ["residential", "new-build"]
    if "mixed-use" in key:
        tags += ["residential", "commercial", "new-build", "mixed-use"]
    for token, role in (
        ("fire", "fire-service"), ("police", "police-service"), ("clinic", "health-service"),
        ("school", "education-service"), ("city-hall", "government-service"), ("post-office", "postal-service"),
    ):
        if token in key:
            service_role = role
            tags.append(role)
            break
    defaults = {
        **raw,
        "platform": platform,
        "estimates": estimates,
        "tags": sorted(set(tags)),
        "ruleIds": list(dict.fromkeys(rule_ids)),
        "entrances": [{"side": "S", "offset": max(0, footprint[0] // 2)}],
        "maxPerCity": max_per_city,
        "maxPerDistrict": max_per_district,
        "serviceRole": service_role,
    }
    # Imported hand-drawn families may override the derived defaults without
    # requiring changes to this builder or the application runtime.
    return {**defaults, **{field: raw[field] for field in (
        "platform", "estimates", "tags", "ruleIds", "entrances",
        "maxPerCity", "maxPerDistrict", "serviceRole",
    ) if field in raw}}


def normalize_imported_sprite(source: Path, *, align_bottom: bool) -> Image.Image:
    """Convert authored/imported art to the runtime pixel-art contract.

    Imported concepts may contain many visually indistinguishable RGB values.
    Runtime sprites reserve palette room for construction overlays, use hard alpha
    edge, and an optional bottom anchor so zooming remains crisp and stable.
    """
    image = Image.open(source).convert("RGBA")
    alpha = image.getchannel("A").point(lambda value: 255 if value >= 128 else 0)
    rgb = Image.new("RGB", image.size)
    rgb.paste(image.convert("RGB"), mask=alpha)
    quantized = rgb.quantize(colors=28, method=Image.Quantize.MEDIANCUT).convert("RGBA")
    quantized.putalpha(alpha)
    pixels = quantized.load()
    for y in range(quantized.height):
        for x in range(quantized.width):
            if pixels[x, y][3] == 0:
                pixels[x, y] = (0, 0, 0, 0)
    bounds = alpha.getbbox()
    if align_bottom and bounds is not None and bounds[3] < quantized.height:
        shifted = Image.new("RGBA", quantized.size, (0, 0, 0, 0))
        shifted.alpha_composite(quantized, (0, quantized.height - bounds[3]))
        return shifted
    return quantized


def imported_building_stage(finished: Image.Image, stage: int) -> Image.Image:
    """Derive honest construction stages for a hand-authored finished sprite.

    The finished source remains the identity authority. Early stages use its
    measured bounds, so the site, foundation and frame keep the same centre,
    footprint and ground line instead of becoming an unrelated generic asset.
    """
    if stage == 5:
        return finished.copy()
    image = Image.new("RGBA", finished.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    bounds = finished.getchannel("A").getbbox()
    if bounds is None:
        return image
    left, top, right, bottom = bounds
    left = max(1, left)
    right = min(finished.width - 1, right)
    ground = min(finished.height - 1, max(bottom - 1, finished.height - 2))
    if stage == 1:
        draw.rectangle((left, ground - 4, right - 1, ground), fill=rgba("#806447ff"), outline=rgba(OUTLINE))
        for x in (left + 1, right - 2):
            draw.line((x, ground - 7, x, ground), fill=rgba("#d1af6aff"))
        return image
    if stage == 2:
        foundation_top = max(top, ground - max(6, finished.height // 8))
        draw.rectangle((left, foundation_top, right - 1, ground), fill=rgba(CONCRETE), outline=rgba(OUTLINE))
        draw.rectangle((left + 3, foundation_top + 3, right - 4, ground - 2), fill=rgba("#76634dff"))
        return image
    if stage == 3:
        frame_top = max(top, ground - max(CELL * 2, int((ground - top) * 0.62)))
        for x in range(left, right, CELL):
            draw.line((x, frame_top, x, ground), fill=rgba(FRAME))
        draw.line((right - 1, frame_top, right - 1, ground), fill=rgba(FRAME))
        for y in range(frame_top, ground + 1, CELL):
            draw.line((left, y, right - 1, y), fill=rgba(FRAME))
        draw.rectangle((left, frame_top, right - 1, ground), outline=rgba(OUTLINE))
        return image
    image.alpha_composite(finished)
    scaffold_left = max(0, left - 2)
    scaffold_right = min(finished.width - 1, right + 1)
    for x in (scaffold_left, scaffold_right):
        draw.line((x, max(1, top - 1), x, ground), fill=rgba(SCAFFOLD))
    for y in range(max(2, top + 2), ground, CELL):
        draw.line((scaffold_left, y, scaffold_right, y), fill=rgba(SCAFFOLD))
    return image


def build_manifest(specs: list[HouseSpec]) -> dict:
    source_manifest = json.loads((V3 / "manifest.json").read_text())
    buildings = {key: building_metadata(key, value) for key, value in source_manifest["buildings"].items()}
    # The original key remains stable for saved worlds, while its regenerated
    # sprite gets the extra vertical cell needed for a house-like roof plane.
    classic_station = buildings["commercial-gas-station"]
    classic_station["spriteSize"] = [48, 32]
    classic_station["anchorPx"] = [24, 32]
    if len({spec.key for spec in specs}) != len(specs):
        raise ValueError("generated-buildings.json contains duplicate keys")
    for spec in specs:
        if spec.key in buildings:
            raise ValueError(f"{spec.key}: key already exists in base pack")
        destination = RUNTIME / "buildings" / "house" / spec.key
        destination.mkdir(parents=True, exist_ok=True)
        stages = []
        for stage in range(1, 6):
            target = destination / f"stage-{stage}.png"
            building_stage(spec, stage).save(target, optimize=True)
            stages.append(str(target.relative_to(RUNTIME)))
        raw = {
            "label": spec.label,
            "category": spec.category,
            "rarity": spec.rarity,
            "spriteSize": list(spec.size),
            "footprintCells": list(spec.footprint),
            "anchorPx": [spec.size[0] // 2, spec.size[1]],
            "stages": stages,
        }
        buildings[spec.key] = building_metadata(spec.key, raw)

    for imported in json.loads((CATALOG / "imported-buildings.json").read_text()):
        key = imported["key"]
        if key in buildings:
            raise ValueError(f"{key}: imported key already exists")
        stage_sources = [SOURCE_ART / path for path in imported["stages"]]
        if any(not source.resolve().is_relative_to(SOURCE_ART.resolve()) for source in stage_sources):
            raise ValueError(f"{key}: stage path leaves sources directory")
        destination = RUNTIME / "buildings" / "imported" / key
        destination.mkdir(parents=True, exist_ok=True)
        stages = []
        finished_source = stage_sources[-1]
        normalized_finished = normalize_imported_sprite(
            finished_source, align_bottom=bool(imported.get("alignBottom")),
        ) if imported.get("normalizePixelArt") else Image.open(finished_source).convert("RGBA")
        for stage, source in enumerate(stage_sources, 1):
            target = destination / f"stage-{stage}.png"
            if imported.get("generateConstructionStages"):
                imported_building_stage(normalized_finished, stage).save(target, optimize=True)
            elif imported.get("normalizePixelArt"):
                normalize_imported_sprite(source, align_bottom=bool(imported.get("alignBottom"))).save(target, optimize=True)
            else:
                shutil.copy2(source, target)
            stages.append(str(target.relative_to(RUNTIME)))
        runtime_import = {field: value for field, value in imported.items() if field not in {
            "normalizePixelArt", "alignBottom", "generateConstructionStages",
        }}
        buildings[key] = building_metadata(key, {**runtime_import, "stages": stages})

    terrain: dict[str, list[str]] = {}
    terrain_dir = RUNTIME / "terrain"
    terrain_dir.mkdir(parents=True, exist_ok=True)
    for kind in TERRAIN_PALETTES:
        terrain[kind] = []
        for variant in range(5 if "WATER" in kind else 3):
            target = terrain_dir / f"{kind.lower()}-{variant}.png"
            terrain_tile(kind, variant).save(target, optimize=True)
            terrain[kind].append(str(target.relative_to(RUNTIME)))

    transition_dir = RUNTIME / "transitions"
    transition_dir.mkdir(parents=True, exist_ok=True)
    transitions = {}
    for material in ("shore", "wet-shore", "stone"):
        transitions[material] = {}
        for direction in "NESW":
            target = transition_dir / f"{material}-{direction.lower()}.png"
            edge_overlay(material, direction).save(target, optimize=True)
            transitions[material][direction] = str(target.relative_to(RUNTIME))

    generated_props = {
        "flower-white": prop_flower("#eee8d4ff", 0), "flower-yellow": prop_flower("#e5bf4fff", 1),
        "flower-red": prop_flower("#d26455ff", 2), "flower-pink": prop_flower("#d88ba3ff", 3),
        "flower-purple": prop_flower("#9a79c1ff", 4), "flower-blue": prop_flower("#6c9ed0ff", 5),
        "bush-dark": prop_bush(0), "bush-light": prop_bush(1), "bush-berries": prop_bush(2),
        "rock-small": prop_rock(0), "rock-cluster": prop_rock(1),
        "reed-green": prop_reed(False), "reed-cattail": prop_reed(True),
        "hill-small": prop_landform("hill-small"), "hill-rocky": prop_landform("hill-rocky"),
        "mountain-peak": prop_landform("mountain-peak"), "mountain-ridge": prop_landform("mountain-ridge"),
        "tree-birch": prop_tree("birch"), "tree-pine": prop_tree("pine"),
        "tree-willow": prop_tree("willow"), "tree-oak": prop_tree("oak"),
        "tree-apple": prop_tree("apple"), "tree-cherry": prop_tree("cherry"),
        "tree-maple": prop_tree("maple"), "tree-cedar": prop_tree("cedar"),
        "tree-cypress": prop_tree("cypress"), "tree-palm": prop_tree("palm"),
        "tree-aspen": prop_tree("aspen"), "tree-deadwood": prop_tree("deadwood"),
        "tree-magnolia": prop_tree("magnolia"), "tree-redwood": prop_tree("redwood"),
        "shrub-hazel": prop_shrub("hazel"), "shrub-fern": prop_shrub("fern"),
        "shrub-flowering": prop_shrub("flowering"), "shrub-dry": prop_shrub("dry"),
        "shrub-hedge": prop_shrub("hedge"), "shrub-juniper": prop_shrub("juniper"),
        "streetlamp-vintage": prop_streetlamp("vintage"), "streetlamp-modern": prop_streetlamp("modern"),
        "streetlamp-solar": prop_streetlamp("solar"), "streetlamp-industrial": prop_streetlamp("industrial"),
        "streetlamp-double": prop_streetlamp("double"), "streetlamp-festive": prop_streetlamp("festive"),
        **{key: prop_park_feature(key) for key in PARK_FEATURE_SIZES},
        "bus-stop-horizontal": prop_bus_stop(False), "bus-stop-vertical": prop_bus_stop(True),
        "city-sign-horizontal": prop_city_sign(False), "city-sign-vertical": prop_city_sign(True),
        "guardrail-horizontal": prop_guardrail(False), "guardrail-vertical": prop_guardrail(True),
        "playground-small": prop_playground(),
        "airplane-small": prop_airplane(0), "airplane-courier": prop_airplane(1), "airplane-twin": prop_airplane(2),
        "fire-engine-horizontal": prop_fire_engine(0), "fire-engine-rescue": prop_fire_engine(1),
        "fire-engine-ladder": prop_fire_engine(2),
        "incident-flame-a": prop_incident_flame(0), "incident-flame-b": prop_incident_flame(1),
        "incident-flame-c": prop_incident_flame(2), "incident-flame-d": prop_incident_flame(3),
        "incident-smoke-a": prop_incident_smoke(0), "incident-smoke-b": prop_incident_smoke(1),
        "incident-smoke-c": prop_incident_smoke(2), "incident-smoke-d": prop_incident_smoke(3),
        "walker-north": prop_walker("N", WALKER_SHIRTS[0]), "walker-east": prop_walker("E", WALKER_SHIRTS[1]),
        "walker-south": prop_walker("S", WALKER_SHIRTS[2]), "walker-west": prop_walker("W", WALKER_SHIRTS[3]),
        "boat-horizontal-a": prop_boat(True, 0), "boat-horizontal-b": prop_boat(True, 1),
        "boat-vertical-a": prop_boat(False, 0), "boat-vertical-b": prop_boat(False, 1),
        "fisher-north": prop_fisher("N", 0), "fisher-east": prop_fisher("E", 1),
        "fisher-south": prop_fisher("S", 2), "fisher-west": prop_fisher("W", 3),
        "resident-reader": prop_resident("reader", 0), "resident-box": prop_resident("box", 1),
        "resident-sweeper": prop_resident("sweeper", 2), "resident-phone": prop_resident("phone", 3),
        "resident-worker": prop_resident("worker", 0), "resident-wave": prop_resident("wave", 1),
        "fence-horizontal": prop_fence(False), "fence-vertical": prop_fence(True),
        "active-district-flag": prop_active_marker(),
    }
    for species in ("fox", "deer", "rabbit", "boar", "duck", "sheep", "dog", "cat"):
        for direction in ("north", "east", "south", "west"):
            generated_props[f"animal-{species}-{direction}"] = prop_animal(species, direction[0].upper())
    prop_dir = RUNTIME / "props"
    prop_manifest = dict(source_manifest["props"])
    for key, image in generated_props.items():
        target = prop_dir / f"{key}.png"
        image.save(target, optimize=True)
        if key in PARK_FEATURE_FOOTPRINTS: footprint = list(PARK_FEATURE_FOOTPRINTS[key])
        elif key == "playground-small": footprint = [3, 2]
        elif key in {"boat-horizontal-a", "boat-horizontal-b", "fire-engine-horizontal", "fire-engine-rescue", "fire-engine-ladder"}: footprint = [3, 1]
        elif key in {"boat-vertical-a", "boat-vertical-b"}: footprint = [1, 3]
        elif key in {"bus-stop-horizontal", "guardrail-horizontal", "fence-horizontal"}: footprint = [2, 1]
        elif key in {"bus-stop-vertical", "guardrail-vertical", "fence-vertical"}: footprint = [1, 2]
        elif key.startswith(("hill-", "mountain-")): footprint = [max(1, image.width // CELL), max(1, image.height // CELL)]
        else: footprint = [1, 1]
        prop_manifest[key] = {
            "label": key.replace("-", " ").title(), "path": str(target.relative_to(RUNTIME)),
            "size": list(image.size), "footprintCells": footprint, "anchorPx": [image.width // 2, image.height],
        }

    tile_manifest = {key: value for key, value in source_manifest["tiles"].items() if key != "curb"}
    tile_dir = RUNTIME / "tiles"
    for key, kind in (("path-pavers", "pavers"), ("path-asphalt", "asphalt")):
        target = tile_dir / f"{key}.png"
        path_tile(kind).save(target, optimize=True)
        tile_manifest[key] = {"path": str(target.relative_to(RUNTIME)), "size": [CELL, CELL], "overlay": False}
    return {
        "version": 4,
        "gridPx": CELL,
        "generator": "scripts/build-pixel-city-pack-v4.py",
        "runtimeAI": False,
        "terrain": terrain,
        "transitions": transitions,
        "tiles": tile_manifest,
        "buildings": buildings,
        "vehicles": source_manifest["vehicles"],
        "props": prop_manifest,
        "provenance": {
            "basePack": "pixel-city-pack-v3",
            "newRuntimeAssets": "deterministic procedural pixel drawing",
            "referenceOnly": "reference/expanded-city-assets-reference.png, reference/fishing-life-reference.png, reference/resident-actions-reference.png, reference/fish-water-reference.png, reference/landmark-ferris-wheel-five-stages-reference.png, reference/landmark-megatall-tower-five-stages-reference.png, reference/landmark-monument-five-stages-reference.png, reference/house-courtyard-block-five-stages-reference.png, reference/civic-hospital-five-stages-reference.png and reference/commercial-gas-station-electric-five-stages-reference.png generated with OpenAI image model",
        },
    }


def validate(manifest: dict) -> None:
    assert manifest["runtimeAI"] is False
    assert len(manifest["buildings"]) >= 44
    for key, building in manifest["buildings"].items():
        assert len(building["stages"]) == 5, key
        width, height = building["spriteSize"]
        assert width % CELL == 0 and height % CELL == 0, key
        assert building["footprintCells"][0] > 0 and building["footprintCells"][1] > 0, key
        assert set(building["ruleIds"]) <= REGISTERED_RULES, (key, building["ruleIds"])
        assert building["entrances"], (key, "missing entrance")
        for entrance in building["entrances"]:
            assert entrance["side"] in "NESW", (key, entrance)
            side_length = building["footprintCells"][0] if entrance["side"] in "NS" else building["footprintCells"][1]
            assert 0 <= entrance["offset"] < side_length, (key, entrance)
        for quota in ("maxPerCity", "maxPerDistrict"):
            assert building[quota] is None or isinstance(building[quota], int) and building[quota] > 0, (key, quota)
        for stage in building["stages"]:
            image = Image.open(RUNTIME / stage).convert("RGBA")
            assert image.size == (width, height), (key, stage, image.size)
            alpha_values = image.getchannel("A").getcolors(maxcolors=256)
            assert alpha_values is not None and all(alpha in (0, 255) for _, alpha in alpha_values), (key, stage, "soft alpha")
    for paths in manifest["terrain"].values():
        for tile_path in paths: assert Image.open(RUNTIME / tile_path).size == (CELL, CELL)
    for key, prop in manifest["props"].items():
        image = Image.open(RUNTIME / prop["path"]).convert("RGBA")
        assert image.width % CELL == 0 and image.height % CELL == 0, (key, image.size)
        alpha_values = image.getchannel("A").getcolors(maxcolors=256)
        assert alpha_values is not None and all(alpha in (0, 255) for _, alpha in alpha_values), (key, "soft alpha")
    for color in CAR_PALETTES:
        vertical = Image.open(RUNTIME / manifest["vehicles"][color]["vertical"]["path"]).convert("RGBA")
        assert vertical.size == (8, 16), (color, vertical.size)
        bounds = vertical.getchannel("A").getbbox()
        assert bounds is not None and bounds[0] == 0 and bounds[2] == 8, (color, bounds, "vertical car must use its full lane-readable width")


def contact_sheet(manifest: dict, specs: list[HouseSpec]) -> None:
    del specs  # The sheet is manifest-driven and therefore also includes imports.
    width = 1600
    # Lay out once before allocating the image so a growing catalog cannot be
    # silently clipped by a stale fixed-height QA canvas.
    placements: list[tuple[str, list[Image.Image], int, int, int]] = []
    x, y, row_height = 20, 20, 0
    for key, building in sorted(manifest["buildings"].items()):
        sprites = [Image.open(RUNTIME / path).convert("RGBA") for path in building["stages"]]
        block_width = sum(sprite.width for sprite in sprites) + 4 * (len(sprites) - 1)
        block_height = max(sprite.height for sprite in sprites) + 14
        if x + block_width > width - 20:
            x, y = 20, y + row_height + 12
            row_height = 0
        placements.append((key, sprites, x, y, block_height))
        x += block_width + 18
        row_height = max(row_height, block_height)
    building_bottom = y + row_height
    height = building_bottom + 250
    image = Image.new("RGBA", (width, height), rgba("#132126ff"))
    draw = ImageDraw.Draw(image)
    for key, sprites, x, y, block_height in placements:
        draw.text((x, y), key, fill=rgba("#91a9aaff"))
        cursor = x
        baseline = y + block_height
        for sprite in sprites:
            image.alpha_composite(sprite, (cursor, baseline - sprite.height))
            cursor += sprite.width + 4

    y = building_bottom + 34
    row_height = 0
    x = 20
    for kind, paths in manifest["terrain"].items():
        for tile_path in paths:
            tile = Image.open(RUNTIME / tile_path).resize((32, 32), Image.Resampling.NEAREST)
            image.alpha_composite(tile, (x, y))
            x += 34
        x += 10
        if x > width - 120: x, y = 20, y + 42
    y += 54
    x = 20
    for key in [name for name in manifest["props"] if name.startswith(("flower-", "bush-", "rock-", "reed-", "hill-", "mountain-", "tree-", "streetlamp-")) or name in PARK_FEATURE_SIZES]:
        source = Image.open(RUNTIME / manifest["props"][key]["path"])
        scale = min(4, max(1, 64 // max(source.size)))
        prop = source.resize((source.width * scale, source.height * scale), Image.Resampling.NEAREST)
        if x + prop.width > width - 20:
            x, y = 20, y + 80
        image.alpha_composite(prop, (x, y))
        x += prop.width + 10
    final_height = max(building_bottom + 120, y + 96)
    image = image.crop((0, 0, width, final_height))
    draw = ImageDraw.Draw(image)
    draw.rectangle((16, 16, width - 17, final_height - 17), outline=rgba("#3a5359ff"), width=2)
    SCREENSHOTS.mkdir(parents=True, exist_ok=True)
    image.convert("RGB").save(SCREENSHOTS / "pixel-city-v4-expanded-assets.png", optimize=True)


def gas_station_style_sheet(manifest: dict) -> None:
    """Render a nearest-neighbour comparison against representative houses."""
    keys = (
        "house-cottage", "house-gabled", "house-modern-lowrise", "house-corner-apartments",
        "commercial-gas-station-compact", "commercial-gas-station", "commercial-highway-service-plaza",
        "commercial-gas-station-electric", "commercial-gas-station-truck",
        "commercial-gas-station-cafe", "commercial-gas-station-wash",
    )
    scale = 6
    card_width, card_height = 240, 210
    rows = (len(keys) + 3) // 4
    image = Image.new("RGB", (card_width * 4, card_height * rows), rgba("#132126ff")[:3])
    draw = ImageDraw.Draw(image)
    for index, key in enumerate(keys):
        building = manifest["buildings"][key]
        sprite = Image.open(RUNTIME / building["stages"][-1]).convert("RGBA")
        sprite = sprite.resize((sprite.width * scale, sprite.height * scale), Image.Resampling.NEAREST)
        column, row = index % 4, index // 4
        left, top = column * card_width, row * card_height
        ground_y = top + card_height - 28
        draw.rectangle((left + 8, top + 8, left + card_width - 8, top + card_height - 8), fill=rgba("#1b2c30ff")[:3], outline=rgba("#3a5359ff")[:3])
        draw.rectangle((left + 9, ground_y, left + card_width - 9, top + card_height - 9), fill=rgba("#526d35ff")[:3])
        x = left + (card_width - sprite.width) // 2
        y = ground_y - sprite.height
        image.paste(sprite, (x, y), sprite)
        draw.text((left + 16, top + 16), key, fill=rgba("#d9e2ddff")[:3])
    SCREENSHOTS.mkdir(parents=True, exist_ok=True)
    image.save(SCREENSHOTS / "gas-station-style-study.png", optimize=True)


def main() -> None:
    if RUNTIME.exists(): shutil.rmtree(RUNTIME)
    RUNTIME.mkdir(parents=True, exist_ok=True)
    copy_v3_runtime()
    specs = load_generated_specs()
    manifest = build_manifest(specs)
    (PACK / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    validate(manifest)
    contact_sheet(manifest, specs)
    gas_station_style_sheet(manifest)
    if PUBLIC.exists(): shutil.rmtree(PUBLIC)
    shutil.copytree(RUNTIME, PUBLIC)
    shutil.copy2(PACK / "manifest.json", PUBLIC / "manifest.json")
    print(json.dumps({
        "buildings": len(manifest["buildings"]), "terrainFamilies": len(manifest["terrain"]),
        "props": len(manifest["props"]), "runtime": str(PUBLIC), "validated": True,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
