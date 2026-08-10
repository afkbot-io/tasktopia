"""Build the complete first-city pixel asset pack on an exact 8px grid."""

from __future__ import annotations

import colorsys
import json
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "assets" / "pixel-city-pack-v3"
SOURCE = PACK / "source"
TILES = PACK / "tiles"
BUILDINGS = PACK / "buildings"
VEHICLES = PACK / "vehicles"
PROPS = PACK / "props"
ATLASES = PACK / "atlas"
DOCS = PACK / "docs"
SCREENSHOTS = ROOT / "screenshots"
BASE = SOURCE / "base"

CELL = 8
STAGE_COUNT = 5
ATLAS_SIZE = 512


@dataclass(frozen=True)
class BuildingSpec:
    key: str
    label: str
    category: str
    size: tuple[int, int]
    footprint: tuple[int, int]
    source_group: str
    rarity: str = "COMMON"

    @property
    def anchor(self) -> tuple[int, int]:
        return self.size[0] // 2, self.size[1]


@dataclass(frozen=True)
class PropSpec:
    key: str
    label: str
    size: tuple[int, int]
    source: str
    segment_count: int = 1
    segment_index: int = 0
    source_group: str = "generated"
    footprint_cells: tuple[int, int] | None = None

    @property
    def footprint(self) -> tuple[int, int]:
        return self.footprint_cells or (self.size[0] // CELL, self.size[1] // CELL)

    @property
    def anchor(self) -> tuple[int, int]:
        return self.size[0] // 2, self.size[1]


BUILDING_SPECS = [
    BuildingSpec("highrise-glass", "Стеклянная высотка", "HIGHRISE", (32, 64), (4, 3), "highrises", "UNCOMMON"),
    BuildingSpec("highrise-brick", "Кирпичная башня", "HIGHRISE", (32, 72), (4, 3), "highrises", "UNCOMMON"),
    BuildingSpec("highrise-stepped", "Ступенчатые апартаменты", "HIGHRISE", (40, 64), (5, 3), "highrises", "RARE"),
    BuildingSpec("highrise-corporate", "Офисная высотка", "HIGHRISE", (40, 72), (5, 3), "highrises", "RARE"),
    BuildingSpec("highrise-landmark", "Городской небоскрёб", "HIGHRISE", (48, 80), (6, 4), "highrises", "UNIQUE"),
    BuildingSpec("house-cottage", "Коттедж", "HOUSE", (16, 24), (2, 2), "houses"),
    BuildingSpec("house-townhouse", "Узкий таунхаус", "HOUSE", (16, 32), (2, 2), "houses"),
    BuildingSpec("house-gabled", "Дом с фронтоном", "HOUSE", (24, 24), (3, 2), "houses"),
    BuildingSpec("house-duplex", "Дуплекс", "HOUSE", (24, 32), (3, 2), "houses"),
    BuildingSpec("house-small-apartments", "Малый жилой дом", "HOUSE", (32, 32), (4, 3), "houses"),
    BuildingSpec("shop-supermarket", "Супермаркет", "COMMERCIAL", (40, 16), (5, 2), "commercial"),
    BuildingSpec("shop-bakery-long", "Пекарня и кафе", "COMMERCIAL", (48, 16), (6, 2), "commercial"),
    BuildingSpec("shop-mall", "Торговый центр", "COMMERCIAL", (56, 24), (7, 3), "commercial", "UNCOMMON"),
    BuildingSpec("shop-warehouse", "Склад-магазин", "COMMERCIAL", (48, 24), (6, 3), "commercial"),
    BuildingSpec("civic-clinic", "Клиника скорой помощи", "CIVIC", (40, 32), (5, 4), "civic", "UNIQUE"),
    BuildingSpec("civic-fire-station", "Пожарная часть", "CIVIC", (48, 32), (6, 4), "civic", "UNIQUE"),
    BuildingSpec("civic-police", "Полицейский участок", "CIVIC", (40, 32), (5, 4), "civic", "UNIQUE"),
    BuildingSpec("civic-bank", "Банк", "CIVIC", (32, 32), (4, 4), "civic", "UNCOMMON"),
    BuildingSpec("civic-school", "Школа", "CIVIC", (48, 40), (6, 5), "civic", "UNIQUE"),
    BuildingSpec("civic-city-hall", "Мэрия", "CIVIC", (48, 40), (6, 5), "civic", "UNIQUE"),
    BuildingSpec("commercial-gas-station", "Заправка", "COMMERCIAL", (48, 24), (6, 3), "expansion", "UNCOMMON"),
    BuildingSpec("commercial-parking-lot", "Городская парковка", "COMMERCIAL", (48, 24), (6, 3), "expansion"),
    BuildingSpec("commercial-shopping-plaza", "Торговая галерея", "COMMERCIAL", (56, 24), (7, 3), "expansion", "UNCOMMON"),
    BuildingSpec("commercial-corner-cafe", "Угловое кафе", "COMMERCIAL", (32, 24), (4, 3), "expansion"),
    BuildingSpec("commercial-pharmacy", "Аптека", "COMMERCIAL", (32, 24), (4, 3), "expansion"),
    BuildingSpec("commercial-auto-repair", "Автосервис", "COMMERCIAL", (40, 24), (5, 3), "expansion"),
    BuildingSpec("house-bungalow", "Пригородное бунгало", "HOUSE", (24, 24), (3, 2), "expansion"),
    BuildingSpec("house-suburban-narrow", "Узкий частный дом", "HOUSE", (24, 32), (3, 3), "expansion"),
    BuildingSpec("house-garden-villa", "Садовая вилла", "HOUSE", (32, 32), (4, 3), "expansion", "UNCOMMON"),
    BuildingSpec("house-modern-compact", "Современный частный дом", "HOUSE", (24, 32), (3, 3), "expansion"),
    BuildingSpec("house-rustic-cottage", "Деревянный коттедж", "HOUSE", (32, 24), (4, 3), "expansion"),
    BuildingSpec("civic-post-office", "Городская почта", "CIVIC", (40, 32), (5, 4), "expansion", "UNCOMMON"),
]

SPEC_BY_KEY = {spec.key: spec for spec in BUILDING_SPECS}

PROP_SPECS = [
    PropSpec("tree-round", "Круглое дерево", (8, 16), "tree-round", source_group="base", footprint_cells=(1, 1)),
    PropSpec("tree-conifer", "Хвойное дерево", (8, 16), "tree-conifer", source_group="base", footprint_cells=(1, 1)),
    PropSpec("tree-flowering", "Цветущее дерево", (8, 16), "tree-flowering", source_group="base", footprint_cells=(1, 1)),
    PropSpec("streetlamp", "Фонарь", (8, 16), "streetlamp", source_group="base", footprint_cells=(1, 1)),
    PropSpec("utility-pole", "Электрический столб", (8, 16), "utility-pole", source_group="base", footprint_cells=(1, 1)),
    PropSpec("bench-vertical", "Скамейка вертикальная", (8, 16), "bench", 2, 0, footprint_cells=(1, 1)),
    PropSpec("bench-horizontal", "Скамейка горизонтальная", (16, 8), "bench", 2, 1),
    PropSpec("trash-bin", "Урна", (8, 8), "trash-bin"),
    PropSpec("recycling-bin", "Контейнер для переработки", (8, 8), "recycling-bin"),
    PropSpec("planter-round", "Круглая клумба", (8, 8), "planter-round"),
    PropSpec("fire-hydrant", "Пожарный гидрант", (8, 8), "fire-hydrant"),
    PropSpec("mailbox", "Почтовый ящик", (8, 8), "mailbox"),
    PropSpec("bollard", "Дорожный столбик", (8, 8), "bollard"),
    PropSpec("bicycle-rack", "Велопарковка", (16, 8), "bicycle-rack"),
    PropSpec("fountain-small", "Малый фонтан", (16, 16), "fountain-small"),
    PropSpec("bus-stop", "Остановка", (16, 16), "bus-stop", footprint_cells=(2, 1)),
    PropSpec("picnic-table", "Стол для пикника", (16, 16), "picnic-table"),
]

PROP_BY_KEY = {spec.key: spec for spec in PROP_SPECS}


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = "Arial Bold.ttf" if bold else "Arial.ttf"
    return ImageFont.truetype(f"/System/Library/Fonts/Supplemental/{name}", size)


def checker(size: tuple[int, int], unit: int = 8) -> Image.Image:
    image = Image.new("RGBA", size, "#172524ff")
    draw = ImageDraw.Draw(image)
    for y in range(0, size[1], unit):
        for x in range(0, size[0], unit):
            if (x // unit + y // unit) % 2:
                draw.rectangle((x, y, x + unit - 1, y + unit - 1), fill="#233936ff")
    return image


def split_equal_columns(path: Path, count: int) -> list[Image.Image]:
    sheet = Image.open(path).convert("RGBA")
    return [
        sheet.crop((round(index * sheet.width / count), 0, round((index + 1) * sheet.width / count), sheet.height))
        for index in range(count)
    ]


def stage_heights(height: int) -> list[int]:
    if height <= 24:
        return [max(7, round(height * 0.50)), max(9, round(height * 0.62)), max(11, round(height * 0.82)), height - 1, height - 1]
    return [min(16, max(10, height // 4)), min(20, max(14, height // 3)), round(height * 0.58), height - 1, height - 1]


def normalize_sprite(source: Image.Image, canvas_size: tuple[int, int], content_size: tuple[int, int], colors: int = 24) -> Image.Image:
    source = source.convert("RGBA")
    bbox = source.getchannel("A").getbbox()
    if bbox is None:
        raise RuntimeError("Empty generated sprite segment")
    cropped = source.crop(bbox)
    reduced = cropped.resize(content_size, Image.Resampling.BOX)
    alpha = reduced.getchannel("A").point(lambda value: 255 if value >= 80 else 0)
    reduced = reduced.quantize(colors=colors, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).convert("RGBA")
    reduced.putalpha(alpha)
    canvas = Image.new("RGBA", canvas_size, (0, 0, 0, 0))
    canvas.alpha_composite(reduced, ((canvas_size[0] - content_size[0]) // 2, canvas_size[1] - content_size[1]))
    return canvas


def normalize_contained_sprite(source: Image.Image, canvas_size: tuple[int, int], colors: int = 16) -> Image.Image:
    """Fit a prop inside its canvas without distorting its generated aspect ratio."""
    source = source.convert("RGBA")
    bbox = source.getchannel("A").getbbox()
    if bbox is None:
        raise RuntimeError("Empty generated prop")
    cropped = source.crop(bbox)
    scale = min(canvas_size[0] / cropped.width, canvas_size[1] / cropped.height)
    content_size = (
        max(1, min(canvas_size[0], round(cropped.width * scale))),
        max(1, min(canvas_size[1], round(cropped.height * scale))),
    )
    reduced = cropped.resize(content_size, Image.Resampling.BOX)
    alpha = reduced.getchannel("A").point(lambda value: 255 if value >= 80 else 0)
    reduced = reduced.quantize(colors=colors, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).convert("RGBA")
    reduced.putalpha(alpha)
    canvas = Image.new("RGBA", canvas_size, (0, 0, 0, 0))
    canvas.alpha_composite(reduced, ((canvas_size[0] - content_size[0]) // 2, canvas_size[1] - content_size[1]))
    return canvas


def build_buildings() -> dict[str, Image.Image]:
    assets: dict[str, Image.Image] = {}
    for spec in BUILDING_SPECS:
        source = SOURCE / spec.source_group / f"{spec.key}.png"
        segments = split_equal_columns(source, STAGE_COUNT)
        heights = stage_heights(spec.size[1])
        destination = BUILDINGS / spec.category.lower() / spec.key
        destination.mkdir(parents=True, exist_ok=True)
        for index, (segment, content_height) in enumerate(zip(segments, heights, strict=True), start=1):
            sprite = normalize_sprite(segment, spec.size, (spec.size[0] - 2, content_height))
            asset_id = f"{spec.key}-stage-{index}"
            sprite.save(destination / f"stage-{index}.png", optimize=True)
            assets[asset_id] = sprite
    return assets


def build_props() -> dict[str, Image.Image]:
    assets: dict[str, Image.Image] = {}
    PROPS.mkdir(parents=True, exist_ok=True)
    for spec in PROP_SPECS:
        if spec.source_group == "base":
            source = Image.open(BASE / "props" / f"{spec.source}.png").convert("RGBA")
        else:
            source_path = SOURCE / "props" / f"{spec.source}.png"
            source = split_equal_columns(source_path, spec.segment_count)[spec.segment_index]
        sprite = normalize_contained_sprite(source, spec.size)
        sprite.save(PROPS / f"{spec.key}.png", optimize=True)
        assets[spec.key] = sprite
    return assets


def tile_grass() -> Image.Image:
    return Image.open(BASE / "tiles" / "grass.png").convert("RGBA")


def tile_road() -> Image.Image:
    return Image.open(BASE / "tiles" / "road.png").convert("RGBA")


def tile_curb() -> Image.Image:
    return Image.open(BASE / "tiles" / "curb.png").convert("RGBA")


def tile_pavement() -> Image.Image:
    return Image.open(BASE / "tiles" / "pavement.png").convert("RGBA")


def tile_path() -> Image.Image:
    image = Image.new("RGBA", (8, 8), "#876c45ff")
    pixels = image.load()
    for x, y, color in [
        (0, 1, "#715638ff"), (3, 0, "#9f8152ff"), (6, 2, "#6d5338ff"),
        (2, 4, "#a58a5bff"), (7, 5, "#73583aff"), (4, 7, "#9b7d4fff"),
    ]:
        pixels[x, y] = tuple(bytes.fromhex(color[1:]))
    return image


def tile_water() -> Image.Image:
    image = Image.new("RGBA", (8, 8), "#246fa5ff")
    draw = ImageDraw.Draw(image)
    draw.line((0, 1, 3, 1), fill="#3f8bb9ff")
    draw.line((5, 3, 7, 3), fill="#195f92ff")
    draw.line((1, 6, 5, 6), fill="#5a9bc2ff")
    draw.point((6, 7), fill="#174f80ff")
    return image


def tile_crosswalk(horizontal_movement: bool) -> Image.Image:
    image = Image.new("RGBA", (8, 8), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    if horizontal_movement:
        for x in (1, 5):
            draw.rectangle((x, 0, x + 1, 7), fill="#e4e9e6ff")
    else:
        for y in (1, 5):
            draw.rectangle((0, y, 7, y + 1), fill="#e4e9e6ff")
    return image


def tile_marking(horizontal: bool) -> Image.Image:
    image = Image.new("RGBA", (8, 8), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    if horizontal:
        draw.line((2, 3, 5, 3), fill="#dce3dfff")
    else:
        draw.line((3, 2, 3, 5), fill="#dce3dfff")
    return image


def tile_bridge_side(horizontal: bool) -> Image.Image:
    image = Image.new("RGBA", (8, 8), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    if horizontal:
        draw.line((0, 1, 7, 1), fill="#253949ff")
        draw.line((0, 2, 7, 2), fill="#d1d7cfff")
        draw.line((0, 3, 7, 3), fill="#738a94ff")
        for x in (1, 6):
            draw.line((x, 0, x, 4), fill="#9eadafff")
    else:
        draw.line((1, 0, 1, 7), fill="#253949ff")
        draw.line((2, 0, 2, 7), fill="#d1d7cfff")
        draw.line((3, 0, 3, 7), fill="#738a94ff")
        for y in (1, 6):
            draw.line((0, y, 4, y), fill="#9eadafff")
    return image


def build_tiles() -> dict[str, Image.Image]:
    assets = {
        "grass": tile_grass(),
        "road": tile_road(),
        "curb": tile_curb(),
        "pavement": tile_pavement(),
        "path-brown": tile_path(),
        "water": tile_water(),
        "crosswalk-horizontal": tile_crosswalk(True),
        "crosswalk-vertical": tile_crosswalk(False),
        "road-marking-horizontal": tile_marking(True),
        "road-marking-vertical": tile_marking(False),
        "bridge-side-horizontal": tile_bridge_side(True),
        "bridge-side-vertical": tile_bridge_side(False),
    }
    TILES.mkdir(parents=True, exist_ok=True)
    for name, image in assets.items():
        image.save(TILES / f"{name}.png", optimize=True)
    return assets


CAR_PALETTES = {
    "blue": [(17, 51, 71), (24, 82, 108), (34, 112, 140), (47, 148, 166)],
    "red": [(68, 31, 37), (118, 43, 49), (170, 58, 58), (220, 84, 72)],
    "yellow": [(79, 59, 27), (142, 99, 29), (205, 149, 40), (241, 197, 71)],
    "green": [(24, 61, 45), (35, 96, 65), (53, 138, 83), (82, 180, 104)],
}


def recolor_car(sprite: Image.Image, palette: list[tuple[int, int, int]]) -> Image.Image:
    output = sprite.copy()
    pixels = output.load()
    for y in range(output.height):
        for x in range(output.width):
            red, green, blue, alpha = pixels[x, y]
            if alpha == 0:
                continue
            hue, saturation, value = colorsys.rgb_to_hsv(red / 255, green / 255, blue / 255)
            if 0.44 <= hue <= 0.66 and saturation >= 0.25:
                index = min(3, max(0, round(value * 3)))
                target = palette[index]
                pixels[x, y] = (*target, alpha)
    return output


def draw_vertical_car(palette: list[tuple[int, int, int]]) -> Image.Image:
    """Draw the top-down axis explicitly so it stays centred and readable at 8px."""
    image = Image.new("RGBA", (8, 16), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    outline = (25, 38, 47, 255)
    glass_dark = (38, 73, 86, 255)
    glass_light = (78, 137, 151, 255)
    tire = (19, 28, 34, 255)
    draw.rectangle((1, 1, 6, 14), fill=(*palette[1], 255), outline=outline)
    draw.rectangle((2, 0, 5, 1), fill=(*palette[2], 255), outline=outline)
    draw.rectangle((0, 4, 0, 6), fill=tire)
    draw.rectangle((7, 4, 7, 6), fill=tire)
    draw.rectangle((0, 10, 0, 12), fill=tire)
    draw.rectangle((7, 10, 7, 12), fill=tire)
    draw.rectangle((2, 3, 5, 5), fill=glass_dark)
    draw.rectangle((2, 4, 5, 4), fill=glass_light)
    draw.rectangle((2, 6, 5, 10), fill=(*palette[2], 255))
    draw.line((2, 6, 5, 6), fill=(*palette[3], 255))
    draw.rectangle((2, 11, 5, 12), fill=glass_dark)
    draw.point((2, 1), fill=(245, 220, 143, 255))
    draw.point((5, 1), fill=(245, 220, 143, 255))
    draw.point((2, 14), fill=(191, 61, 55, 255))
    draw.point((5, 14), fill=(191, 61, 55, 255))
    return image


def build_vehicles() -> dict[str, Image.Image]:
    _vertical_reference, horizontal_source = split_equal_columns(
        SOURCE / "vehicles" / "car-oblique-v2.png", 2
    )
    # Each direction is drawn for the shared oblique camera. A mechanical
    # rotation would turn the visible hood/windshield into the wrong projection.
    base_horizontal = normalize_sprite(horizontal_source, (16, 8), (16, 8), colors=16)
    assets: dict[str, Image.Image] = {}
    VEHICLES.mkdir(parents=True, exist_ok=True)
    for color, palette in CAR_PALETTES.items():
        vertical = draw_vertical_car(palette)
        horizontal = recolor_car(base_horizontal, palette)
        vertical.save(VEHICLES / f"car-{color}-vertical.png", optimize=True)
        horizontal.save(VEHICLES / f"car-{color}-horizontal.png", optimize=True)
        assets[f"car-{color}-vertical"] = vertical
        assets[f"car-{color}-horizontal"] = horizontal
    return assets


def pack_atlases(assets: dict[str, Image.Image]) -> tuple[list[Path], dict[str, dict[str, int]]]:
    ATLASES.mkdir(parents=True, exist_ok=True)
    pages: list[Image.Image] = [Image.new("RGBA", (ATLAS_SIZE, ATLAS_SIZE), (0, 0, 0, 0))]
    frames: dict[str, dict[str, int]] = {}
    page_index = 0
    x = y = row_height = 0
    for name, sprite in sorted(assets.items(), key=lambda item: (-item[1].height, -item[1].width, item[0])):
        if x + sprite.width > ATLAS_SIZE:
            x = 0
            y += row_height
            row_height = 0
        if y + sprite.height > ATLAS_SIZE:
            pages.append(Image.new("RGBA", (ATLAS_SIZE, ATLAS_SIZE), (0, 0, 0, 0)))
            page_index += 1
            x = y = row_height = 0
        pages[page_index].alpha_composite(sprite, (x, y))
        frames[name] = {"page": page_index, "x": x, "y": y, "w": sprite.width, "h": sprite.height}
        x += sprite.width
        row_height = max(row_height, sprite.height)
    paths: list[Path] = []
    for index, page in enumerate(pages):
        path = ATLASES / f"atlas-{index}.png"
        page.save(path, optimize=True)
        paths.append(path)
    return paths, frames


def build_category_catalog(category: str, title: str, building_assets: dict[str, Image.Image], scale: int) -> Path:
    specs = [spec for spec in BUILDING_SPECS if spec.category == category]
    left = 260
    row_heights = [spec.size[1] * scale + 64 for spec in specs]
    width = max(1180, left + max(spec.size[0] * scale * 5 + 80 for spec in specs))
    height = 100 + sum(row_heights)
    canvas = Image.new("RGBA", (width, height), "#0d1818ff")
    draw = ImageDraw.Draw(canvas)
    draw.text((32, 24), title, font=font(30, True), fill="#eef3ed")
    draw.text((32, 65), "stages 1–5 · exact runtime canvases · nearest-neighbor", font=font(15), fill="#9eb1aa")
    y = 104
    for spec, row_height in zip(specs, row_heights, strict=True):
        draw.text((32, y + 10), spec.label, font=font(18, True), fill="#e5ebe5")
        draw.text((32, y + 38), f"{spec.size[0]}×{spec.size[1]} · footprint {spec.footprint[0]}×{spec.footprint[1]}", font=font(13), fill="#8fa5a5")
        x = left
        for stage in range(1, 6):
            sprite = building_assets[f"{spec.key}-stage-{stage}"]
            panel_size = (spec.size[0] * scale, spec.size[1] * scale)
            canvas.alpha_composite(checker(panel_size, max(8, scale * 2)), (x, y))
            canvas.alpha_composite(sprite.resize(panel_size, Image.Resampling.NEAREST), (x, y))
            draw.text((x + 4, y + panel_size[1] + 8), f"{stage}", font=font(13, True), fill="#dfe7e1")
            x += panel_size[0] + 12
        y += row_height
    path = SCREENSHOTS / f"pixel-city-v3-{category.lower()}.png"
    canvas.convert("RGB").save(path, quality=95)
    return path


def build_tile_vehicle_catalog(tile_assets: dict[str, Image.Image], vehicle_assets: dict[str, Image.Image]) -> Path:
    canvas = Image.new("RGBA", (1500, 920), "#0d1818ff")
    draw = ImageDraw.Draw(canvas)
    draw.text((32, 24), "PIXEL CITY V3 · TILES & VEHICLES", font=font(30, True), fill="#eef3ed")
    draw.text((32, 65), "every map block 8×8 · cars use matched oblique views", font=font(15), fill="#9eb1aa")
    for index, (name, sprite) in enumerate(tile_assets.items()):
        column, row = index % 6, index // 6
        x, y = 32 + column * 240, 120 + row * 250
        canvas.alpha_composite(checker((160, 160), 16), (x, y))
        canvas.alpha_composite(sprite.resize((128, 128), Image.Resampling.NEAREST), (x + 16, y + 16))
        draw.text((x, y + 172), f"{name} · 8×8", font=font(13, True), fill="#dfe7e1")
    y = 650
    for index, color in enumerate(CAR_PALETTES):
        x = 32 + index * 350
        canvas.alpha_composite(checker((256, 192), 16), (x, y))
        vertical = vehicle_assets[f"car-{color}-vertical"].resize((64, 128), Image.Resampling.NEAREST)
        horizontal = vehicle_assets[f"car-{color}-horizontal"].resize((128, 64), Image.Resampling.NEAREST)
        canvas.alpha_composite(vertical, (x + 24, y + 32))
        canvas.alpha_composite(horizontal, (x + 108, y + 64))
        draw.text((x, y + 204), f"car-{color} · 8×16 / 16×8", font=font(13, True), fill="#dfe7e1")
    path = SCREENSHOTS / "pixel-city-v3-tiles-vehicles.png"
    canvas.convert("RGB").save(path, quality=95)
    return path


def build_prop_catalog(prop_assets: dict[str, Image.Image]) -> Path:
    columns = 4
    panel_width, panel_height = 300, 190
    rows = (len(PROP_SPECS) + columns - 1) // columns
    canvas = Image.new("RGBA", (32 + columns * panel_width, 110 + rows * panel_height), "#0d1818ff")
    draw = ImageDraw.Draw(canvas)
    draw.text((32, 24), "PIXEL CITY V3 · STREET PROPS", font=font(30, True), fill="#eef3ed")
    draw.text((32, 65), "separate transparent sprites · bottom-center anchors", font=font(15), fill="#9eb1aa")
    for index, spec in enumerate(PROP_SPECS):
        column, row = index % columns, index // columns
        x, y = 32 + column * panel_width, 110 + row * panel_height
        panel_size = (192, 128)
        canvas.alpha_composite(checker(panel_size, 16), (x, y))
        sprite = prop_assets[spec.key]
        scale = min(10, 112 // sprite.height, 176 // sprite.width)
        preview = sprite.resize((sprite.width * scale, sprite.height * scale), Image.Resampling.NEAREST)
        canvas.alpha_composite(preview, (x + (panel_size[0] - preview.width) // 2, y + panel_size[1] - preview.height - 8))
        draw.text((x, y + 138), spec.label, font=font(13, True), fill="#dfe7e1")
        draw.text((x, y + 158), f"{spec.key} · {spec.size[0]}×{spec.size[1]}", font=font(11), fill="#8fa5a5")
    path = SCREENSHOTS / "pixel-city-v3-props.png"
    canvas.convert("RGB").save(path, quality=95)
    return path


def paint_tiled_background(width: int, height: int, grass: Image.Image, water_cells: set[tuple[int, int]], water: Image.Image) -> Image.Image:
    image = Image.new("RGBA", (width * CELL, height * CELL))
    grass_variants = [grass, grass.transpose(Image.Transpose.FLIP_LEFT_RIGHT), grass.transpose(Image.Transpose.FLIP_TOP_BOTTOM), grass.transpose(Image.Transpose.ROTATE_180)]
    water_variants = [water, water.transpose(Image.Transpose.FLIP_LEFT_RIGHT), water.transpose(Image.Transpose.ROTATE_180)]
    for y in range(height):
        for x in range(width):
            if (x, y) in water_cells:
                image.alpha_composite(water_variants[(x + y * 2) % len(water_variants)], (x * CELL, y * CELL))
            else:
                image.alpha_composite(grass_variants[(x * 5 + y * 3) % 4], (x * CELL, y * CELL))
    return image


def paint_curbs(image: Image.Image, roads: set[tuple[int, int]], bridges: set[tuple[int, int]], curb: Image.Image, width: int, height: int) -> None:
    top, bottom = curb, curb.transpose(Image.Transpose.ROTATE_180)
    left, right = curb.transpose(Image.Transpose.ROTATE_90), curb.transpose(Image.Transpose.ROTATE_270)
    for x, y in roads:
        if (x, y) in bridges:
            continue
        if y > 0 and (x, y - 1) not in roads:
            image.alpha_composite(top, (x * CELL, y * CELL - 3))
        if y < height - 1 and (x, y + 1) not in roads:
            image.alpha_composite(bottom, (x * CELL, (y + 1) * CELL - 5))
        if x > 0 and (x - 1, y) not in roads:
            image.alpha_composite(left, (x * CELL - 3, y * CELL))
        if x < width - 1 and (x + 1, y) not in roads:
            image.alpha_composite(right, ((x + 1) * CELL - 5, y * CELL))


def city_scene(all_assets: dict[str, Image.Image]) -> tuple[Path, Path]:
    width, height = 112, 64
    water_cells: set[tuple[int, int]] = set()
    for y in range(height):
        center = 83 + (1 if 12 <= y < 24 else 0) - (1 if 40 <= y < 54 else 0)
        river_width = 6 if y % 11 else 7
        for x in range(center - river_width // 2, center + (river_width + 1) // 2):
            water_cells.add((x, y))
    image = paint_tiled_background(width, height, all_assets["grass"], water_cells, all_assets["water"])

    roads: set[tuple[int, int]] = set()
    roads.update((x, y) for x in range(width) for y in range(30, 34))
    roads.update((x, y) for x in range(34, 38) for y in range(height))
    roads.update((x, y) for x in range(72, 76) for y in range(height))
    roads.update((x, y) for x in range(0, 76) for y in range(14, 18))
    roads.update((x, y) for x in range(34, width) for y in range(48, 52))
    bridges = roads & water_cells
    for x, y in roads:
        image.alpha_composite(all_assets["road"], (x * CELL, y * CELL))
    paint_curbs(image, roads, bridges, all_assets["curb"], width, height)

    # Bridge rails use explicit 8×8 overlay tiles on the outer bridge rows.
    bridge_top = all_assets["bridge-side-horizontal"]
    bridge_bottom = bridge_top.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    for x, y in bridges:
        if (x, y - 1) not in bridges and (x, y - 1) not in roads:
            image.alpha_composite(bridge_top, (x * CELL, y * CELL))
        if (x, y + 1) not in bridges and (x, y + 1) not in roads:
            image.alpha_composite(bridge_bottom, (x * CELL, y * CELL))

    # Crosswalks are tiled overlays; nothing is painted directly with lines.
    for center_x, center_y in ((36, 32), (74, 32), (36, 16), (74, 50)):
        for offset in (-2, -1, 0, 1):
            image.alpha_composite(all_assets["crosswalk-horizontal"], ((center_x + offset) * CELL, (center_y - 2) * CELL))
            image.alpha_composite(all_assets["crosswalk-horizontal"], ((center_x + offset) * CELL, (center_y + 1) * CELL))

    # Brown paths are also ordinary cells and lead into parks and civic plots.
    path_cells: set[tuple[int, int]] = set()
    path_cells.update((x, 25) for x in range(3, 30))
    path_cells.update((20, y) for y in range(18, 30))
    path_cells.update((x, 58) for x in range(4, 31))
    path_cells.update((x, 43) for x in range(88, 107))
    for x, y in path_cells - roads - water_cells:
        image.alpha_composite(all_assets["path-brown"], (x * CELL, y * CELL))

    platforms: list[tuple[int, int, int, int]] = []
    renderables: list[tuple[int, int, str, int, int]] = []

    def queue_building(key: str, stage: int, anchor_x: int, anchor_y: int) -> None:
        spec = SPEC_BY_KEY[key]
        footprint_x = anchor_x - spec.footprint[0] // 2
        footprint_y = anchor_y - spec.footprint[1]
        platforms.append((footprint_x, footprint_y, spec.footprint[0], spec.footprint[1]))
        sprite = all_assets[f"{key}-stage-{stage}"]
        anchor_world_x = footprint_x * CELL + spec.footprint[0] * CELL // 2
        anchor_world_y = anchor_y * CELL
        renderables.append((anchor_y, anchor_x, f"{key}-stage-{stage}", anchor_world_x - spec.anchor[0], anchor_world_y - spec.anchor[1]))

    # Civic north side.
    for args in [
        ("civic-clinic", 5, 6, 14), ("civic-fire-station", 4, 15, 14),
        ("civic-police", 5, 25, 14), ("civic-bank", 5, 45, 14),
        ("civic-school", 3, 56, 14), ("civic-city-hall", 5, 66, 14),
        ("civic-post-office", 5, 95, 14),
    ]:
        queue_building(*args)

    # Downtown high-rises above the main avenue.
    for args in [
        ("highrise-glass", 5, 42, 30), ("highrise-brick", 4, 49, 30),
        ("highrise-stepped", 5, 56, 30), ("highrise-corporate", 3, 63, 30),
        ("highrise-landmark", 5, 69, 30),
    ]:
        queue_building(*args)

    # Commercial streets and riverfront.
    for args in [
        ("commercial-gas-station", 5, 5, 30),
        ("commercial-parking-lot", 5, 14, 30),
        ("commercial-shopping-plaza", 4, 25, 30),
        ("commercial-auto-repair", 5, 90, 30),
        ("commercial-corner-cafe", 5, 96, 30),
        ("commercial-pharmacy", 3, 102, 30),
    ]:
        queue_building(*args)

    # Residential neighborhoods below the avenues.
    house_keys = [
        "house-bungalow", "house-suburban-narrow", "house-garden-villa",
        "house-modern-compact", "house-rustic-cottage",
    ]
    for index, anchor_x in enumerate((5, 10, 15, 21, 27)):
        queue_building(house_keys[index], 1 if index == 0 else 5, anchor_x, 48)
    original_house_keys = ["house-cottage", "house-townhouse", "house-gabled", "house-duplex", "house-small-apartments"]
    for index, anchor_x in enumerate((42, 48, 54, 61, 68)):
        queue_building(original_house_keys[index], 2 if index == 3 else 5, anchor_x, 48)
    for index, anchor_x in enumerate((5, 11, 17, 23, 29, 42, 49, 56, 63, 69, 91, 98, 105)):
        mixed_houses = house_keys + original_house_keys
        queue_building(mixed_houses[index % len(mixed_houses)], 5, anchor_x, 63)

    pavement = all_assets["pavement"]
    for origin_x, origin_y, footprint_w, footprint_h in platforms:
        for row in range(footprint_h):
            for column in range(footprint_w):
                if (origin_x + column, origin_y + row) in roads:
                    continue
                tile = pavement if (row + column) % 2 == 0 else pavement.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                image.alpha_composite(tile, ((origin_x + column) * CELL, (origin_y + row) * CELL))

    def queue_prop(name: str, cell_x: int, ground_y: int) -> None:
        spec = PROP_BY_KEY[name]
        anchor_world_x = cell_x * CELL + CELL // 2
        anchor_world_y = ground_y * CELL
        renderables.append((ground_y + 1, cell_x, name, anchor_world_x - spec.anchor[0], anchor_world_y - spec.anchor[1]))

    props = [
        ("tree-round", 3, 24), ("tree-conifer", 8, 24), ("tree-flowering", 13, 24),
        ("tree-round", 23, 24), ("tree-flowering", 28, 24),
        ("tree-round", 89, 43), ("tree-conifer", 95, 43), ("tree-flowering", 101, 43),
        ("streetlamp", 2, 29), ("streetlamp", 31, 29), ("streetlamp", 39, 35),
        ("streetlamp", 70, 35), ("streetlamp", 77, 29), ("streetlamp", 109, 29),
        ("utility-pole", 32, 12), ("utility-pole", 39, 12), ("utility-pole", 70, 12), ("utility-pole", 77, 12),
        ("bench-horizontal", 15, 24), ("trash-bin", 17, 24),
        ("fountain-small", 20, 23), ("picnic-table", 27, 26),
        ("planter-round", 5, 25), ("recycling-bin", 30, 25),
        ("bench-vertical", 91, 43), ("planter-round", 99, 43),
        ("bus-stop", 32, 29), ("bicycle-rack", 67, 13),
        ("fire-hydrant", 18, 13), ("mailbox", 99, 13),
        ("bollard", 98, 29), ("bollard", 100, 29),
    ]
    for name, x, ground_y in props:
        queue_prop(name, x, ground_y)

    for _, _, name, x, y in sorted(renderables):
        image.alpha_composite(all_assets[name], (x, y))

    # Cars use one-cell or two-cell sprites and match the road direction.
    cars = [
        ("car-blue-horizontal", 8, 31), ("car-red-horizontal", 26, 32),
        ("car-yellow-horizontal", 53, 31), ("car-green-horizontal", 92, 32),
        ("car-red-vertical", 35, 4), ("car-green-vertical", 36, 39),
        ("car-blue-vertical", 73, 22), ("car-yellow-vertical", 74, 55),
    ]
    for name, x, y in cars:
        image.alpha_composite(all_assets[name], (x * CELL, y * CELL))

    base_path = SCREENSHOTS / "pixel-city-v3-first-city-base.png"
    image.save(base_path, optimize=True)
    preview = image.resize((image.width * 2, image.height * 2), Image.Resampling.NEAREST)
    game = Image.new("RGB", (preview.width, preview.height + 72), "#0d1818")
    game.paste(preview.convert("RGB"), (0, 72))
    draw = ImageDraw.Draw(game)
    draw.rectangle((0, 0, game.width, 71), fill="#101c20")
    draw.line((0, 71, game.width, 71), fill="#30454b")
    for column, bar_height in enumerate((12, 20, 16)):
        draw.rectangle((24 + column * 7, 42 - bar_height, 28 + column * 7, 42), fill="#76b6d3")
    draw.text((52, 20), "TASKTOPIA", font=font(25, True), fill="#eef3ed")
    draw.text((250, 16), "СТРАНА", font=font(10, True), fill="#82989b")
    draw.text((250, 33), "Брайтленд", font=font(16, True), fill="#dfe7e1")
    draw.text((440, 16), "ГОРОД", font=font(10, True), fill="#82989b")
    draw.text((440, 33), "Первый город", font=font(16, True), fill="#dfe7e1")
    draw.text((game.width - 500, 27), "● 8 в работе     32 завершено     40 задач", font=font(14, True), fill="#b9c7c4")
    game_path = SCREENSHOTS / "pixel-city-v3-first-city.png"
    game.save(game_path, quality=95)
    return base_path, game_path


def validate(buildings: dict[str, Image.Image], tiles: dict[str, Image.Image], vehicles: dict[str, Image.Image], props: dict[str, Image.Image], frames: dict[str, dict[str, int]]) -> dict[str, object]:
    expected_building_stages = len(BUILDING_SPECS) * STAGE_COUNT
    if len(buildings) != expected_building_stages:
        raise RuntimeError(f"Expected {expected_building_stages} building stages, got {len(buildings)}")
    for spec in BUILDING_SPECS:
        for stage in range(1, 6):
            name = f"{spec.key}-stage-{stage}"
            sprite = buildings[name]
            if sprite.size != spec.size:
                raise RuntimeError(f"{name}: expected {spec.size}, got {sprite.size}")
            if sprite.getchannel("A").getbbox() is None:
                raise RuntimeError(f"{name}: empty alpha")
            if set(sprite.getchannel("A").tobytes()) - {0, 255}:
                raise RuntimeError(f"{name}: soft alpha found")
    for name, tile in tiles.items():
        if tile.size != (8, 8):
            raise RuntimeError(f"{name}: tile must be 8x8")
    if any(token in name for name in tiles for token in ("intersection", "corner", "t-junction")):
        raise RuntimeError("Forbidden prebuilt road topology sprite found")
    for spec in PROP_SPECS:
        sprite = props[spec.key]
        if sprite.size != spec.size:
            raise RuntimeError(f"{spec.key}: expected {spec.size}, got {sprite.size}")
        alpha = sprite.getchannel("A")
        if alpha.getbbox() is None:
            raise RuntimeError(f"{spec.key}: empty alpha")
        if set(alpha.tobytes()) - {0, 255}:
            raise RuntimeError(f"{spec.key}: soft alpha found")
    for color in CAR_PALETTES:
        vertical = vehicles[f"car-{color}-vertical"]
        horizontal = vehicles[f"car-{color}-horizontal"]
        if vertical.size != (8, 16) or horizontal.size != (16, 8):
            raise RuntimeError(f"car-{color}: invalid dimensions")
        for orientation, sprite in (("vertical", vertical), ("horizontal", horizontal)):
            alpha = sprite.getchannel("A")
            if alpha.getbbox() is None:
                raise RuntimeError(f"car-{color}-{orientation}: empty alpha")
            if set(alpha.tobytes()) - {0, 255}:
                raise RuntimeError(f"car-{color}-{orientation}: soft alpha found")
        if horizontal.tobytes() == vertical.transpose(Image.Transpose.ROTATE_270).tobytes():
            raise RuntimeError(f"car-{color}: oblique views collapsed into a mechanical rotation")
    for orientation in ("vertical", "horizontal"):
        alpha_masks = {
            vehicles[f"car-{color}-{orientation}"].getchannel("A").tobytes()
            for color in CAR_PALETTES
        }
        if len(alpha_masks) != 1:
            raise RuntimeError(f"car-{orientation}: palette variants changed geometry")
    return {
        "gridPx": CELL,
        "tileCount": len(tiles),
        "buildingFamilies": len(BUILDING_SPECS),
        "buildingStages": len(buildings),
        "vehicleSprites": len(vehicles),
        "propSprites": len(props),
        "allDimensionsMultipleOfGrid": True,
        "prebuiltRoadTopologySprites": 0,
    }


def main() -> None:
    for directory in (TILES, BUILDINGS, VEHICLES, PROPS, ATLASES, DOCS, SCREENSHOTS):
        directory.mkdir(parents=True, exist_ok=True)
    tile_assets = build_tiles()
    building_assets = build_buildings()
    vehicle_assets = build_vehicles()
    prop_assets = build_props()
    runtime_assets = {**tile_assets, **building_assets, **vehicle_assets, **prop_assets}
    atlas_paths, frames = pack_atlases(runtime_assets)
    validation = validate(building_assets, tile_assets, vehicle_assets, prop_assets, frames)

    catalogs = [
        build_category_catalog("HIGHRISE", "PIXEL CITY V3 · HIGH-RISES", building_assets, 3),
        build_category_catalog("HOUSE", "PIXEL CITY V3 · SMALL HOUSES", building_assets, 5),
        build_category_catalog("COMMERCIAL", "PIXEL CITY V3 · COMMERCIAL", building_assets, 4),
        build_category_catalog("CIVIC", "PIXEL CITY V3 · CIVIC BUILDINGS", building_assets, 4),
        build_tile_vehicle_catalog(tile_assets, vehicle_assets),
        build_prop_catalog(prop_assets),
    ]
    city_base, city_game = city_scene(runtime_assets)

    manifest = {
        "version": 3,
        "gridPx": CELL,
        "tiles": {
            name: {"path": f"tiles/{name}.png", "size": [8, 8], "overlay": name not in {"grass", "road", "pavement", "path-brown", "water"}}
            for name in tile_assets
        },
        "buildings": {
            spec.key: {
                "label": spec.label,
                "category": spec.category,
                "rarity": spec.rarity,
                "spriteSize": list(spec.size),
                "footprintCells": list(spec.footprint),
                "anchorPx": list(spec.anchor),
                "stages": [f"buildings/{spec.category.lower()}/{spec.key}/stage-{stage}.png" for stage in range(1, 6)],
            }
            for spec in BUILDING_SPECS
        },
        "vehicles": {
            color: {
                "vertical": {"path": f"vehicles/car-{color}-vertical.png", "size": [8, 16], "footprintCells": [1, 2]},
                "horizontal": {"path": f"vehicles/car-{color}-horizontal.png", "size": [16, 8], "footprintCells": [2, 1]},
            }
            for color in CAR_PALETTES
        },
        "props": {
            spec.key: {
                "label": spec.label,
                "path": f"props/{spec.key}.png",
                "size": list(spec.size),
                "footprintCells": list(spec.footprint),
                "anchorPx": list(spec.anchor),
            }
            for spec in PROP_SPECS
        },
        "atlases": [f"atlas/{path.name}" for path in atlas_paths],
        "frames": frames,
        "validation": validation,
        "provenance": {
            "buildings": "built-in image generation per family; chroma removal; deterministic five-frame split and exact normalization",
            "vehicles": "authored top-down vertical geometry plus generated horizontal reference; deterministic palette variants",
            "tiles": "deterministic authored 8x8 pixels",
            "props": "five self-contained base essentials plus twelve built-in generated street props",
        },
    }
    (PACK / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(validation, ensure_ascii=False))
    for path in [*atlas_paths, *catalogs, city_base, city_game]:
        print(path.relative_to(ROOT))


if __name__ == "__main__":
    main()
