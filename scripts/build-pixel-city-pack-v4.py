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
    raw_specs = json.loads((CATALOG / "generated-buildings.json").read_text())
    return [HouseSpec(
        key=raw["key"], label=raw["label"], size=tuple(raw["spriteSize"]),
        footprint=tuple(raw["footprintCells"]), wall=raw["wall"], dark=raw["dark"],
        roof=raw["roof"], accent=raw["accent"], style=raw["style"],
        rarity=raw.get("rarity", "COMMON"), category=raw.get("category", "HOUSE"),
    ) for raw in raw_specs]


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
    body = "#b7653fff" if species == "fox" else "#9b774fff"
    light = "#dfb071ff" if species == "fox" else "#c6a879ff"
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

    if scaffold:
        draw_frame(draw, width, max(4, canopy_top - 2), bottom)


def draw_finished_house(image: Image.Image, spec: HouseSpec, scaffold: bool) -> None:
    draw = ImageDraw.Draw(image)
    width, height = spec.size
    bottom = height - 2
    top = max(4, height // 4)
    if spec.style.startswith("gas-"):
        draw_gas_station(image, spec, scaffold)
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
        for x in range(8, width - 3, 8): draw.line((x, body_top, x, bottom), fill=rgba(spec.dark))
    if spec.style == "modern":
        draw.rectangle((3, body_top + 4, width // 2, body_top + 8), fill=rgba(spec.accent), outline=rgba(OUTLINE))
    if spec.style == "mixed-use":
        ground_top = max(body_top + 3, bottom - 11)
        draw.rectangle((2, ground_top, width - 4, bottom), fill=rgba("#d8c9a8ff"), outline=rgba(OUTLINE))
        for x in range(4, width - 7, 8):
            draw.rectangle((x, ground_top + 3, x + 5, bottom - 2), fill=rgba(GLASS), outline=rgba(spec.dark))
        draw.line((2, ground_top, width - 4, ground_top), fill=rgba(spec.accent), width=2)
    if scaffold:
        for x in (0, width - 2): draw.line((x, top - 1, x, bottom), fill=rgba(SCAFFOLD))
        for y in range(top + 2, bottom, 7): draw.line((0, y, width - 1, y), fill=rgba(SCAFFOLD))


def building_stage(spec: HouseSpec, stage: int) -> Image.Image:
    image = Image.new("RGBA", spec.size, (0, 0, 0, 0))
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
        for stage, source in enumerate(stage_sources, 1):
            target = destination / f"stage-{stage}.png"
            shutil.copy2(source, target)
            stages.append(str(target.relative_to(RUNTIME)))
        buildings[key] = building_metadata(key, {**imported, "stages": stages})

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
        "bus-stop-horizontal": prop_bus_stop(False), "bus-stop-vertical": prop_bus_stop(True),
        "city-sign-horizontal": prop_city_sign(False), "city-sign-vertical": prop_city_sign(True),
        "guardrail-horizontal": prop_guardrail(False), "guardrail-vertical": prop_guardrail(True),
        "playground-small": prop_playground(),
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
    for species in ("fox", "deer"):
        for direction in ("north", "east", "south", "west"):
            generated_props[f"animal-{species}-{direction}"] = prop_animal(species, direction[0].upper())
    prop_dir = RUNTIME / "props"
    prop_manifest = dict(source_manifest["props"])
    for key, image in generated_props.items():
        target = prop_dir / f"{key}.png"
        image.save(target, optimize=True)
        if key == "playground-small": footprint = [3, 2]
        elif key in {"boat-horizontal-a", "boat-horizontal-b"}: footprint = [3, 1]
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
            "referenceOnly": "reference/expanded-city-assets-reference.png, reference/fishing-life-reference.png, reference/resident-actions-reference.png and reference/fish-water-reference.png generated with OpenAI image model",
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
    width, height = 1600, 1200
    image = Image.new("RGBA", (width, height), rgba("#132126ff"))
    draw = ImageDraw.Draw(image)
    x, y = 20, 20
    row_height = 0
    for key, building in sorted(manifest["buildings"].items()):
        sprites = [Image.open(RUNTIME / path).convert("RGBA") for path in building["stages"]]
        block_width = sum(sprite.width for sprite in sprites) + 4 * (len(sprites) - 1)
        block_height = max(sprite.height for sprite in sprites) + 14
        if x + block_width > width - 20:
            x, y = 20, y + row_height + 12
            row_height = 0
        draw.text((x, y), key, fill=rgba("#91a9aaff"))
        cursor = x
        baseline = y + block_height
        for sprite in sprites:
            image.alpha_composite(sprite, (cursor, baseline - sprite.height))
            cursor += sprite.width + 4
        x += block_width + 18
        row_height = max(row_height, block_height)
    y += row_height + 34
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
    for key in [name for name in manifest["props"] if name.startswith(("flower-", "bush-", "rock-", "reed-", "hill-", "mountain-"))]:
        prop = Image.open(RUNTIME / manifest["props"][key]["path"]).resize((32, 64 if "reed" in key else 32), Image.Resampling.NEAREST)
        image.alpha_composite(prop, (x, y))
        x += prop.width + 10
    final_height = min(height, y + 96)
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
    )
    scale = 6
    card_width, card_height = 240, 210
    image = Image.new("RGB", (card_width * 4, card_height * 2), rgba("#132126ff")[:3])
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
    draw.text((card_width * 3 + 16, card_height + 16), "houses -> fuel stations", fill=rgba("#e2be4fff")[:3])
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
