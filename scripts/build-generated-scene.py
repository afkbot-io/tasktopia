"""Compose QA screenshots from the generated runtime PNG sprites."""

from __future__ import annotations

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets" / "generated-v2"
SCREENSHOTS = ROOT / "screenshots"
SPRITE_SIZE = 190
HEX_WIDTH = 150
HEX_HEIGHT = 168
ROW_STEP = 126


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = "Arial Bold.ttf" if bold else "Arial.ttf"
    return ImageFont.truetype(f"/System/Library/Fonts/Supplemental/{name}", size)


def sprite(group: str, name: str, size: int = SPRITE_SIZE) -> Image.Image:
    image = Image.open(ASSETS / "tiles" / group / f"{name}.png").convert("RGBA")
    return image.resize((size, size), Image.Resampling.LANCZOS)


def center(column: int, row: int) -> tuple[int, int]:
    return 90 + column * HEX_WIDTH + (row % 2) * (HEX_WIDTH // 2), 128 + row * ROW_STEP


def hex_points(column: int, row: int) -> list[tuple[float, float]]:
    x, y = center(column, row)
    radius = HEX_HEIGHT / 2 - 4
    return [(x + radius * math.cos(math.radians(-90 + 60 * index)), y + radius * math.sin(math.radians(-90 + 60 * index))) for index in range(6)]


def paste_at_center(canvas: Image.Image, image: Image.Image, location: tuple[int, int]) -> None:
    x, y = location
    canvas.alpha_composite(image, (round(x - image.width / 2), round(y - image.height / 2)))


def draw_district(canvas: Image.Image, cells: set[tuple[int, int]], color: str) -> None:
    # Draw only the perimeter of a connected group. A mask-based dilation leaves
    # coloured seams between slightly separated rendered hexes, which makes a
    # district look like a collection of selected tiles instead of one place.
    perimeter = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(perimeter)
    for column, row in cells:
        points = hex_points(column, row)
        if row % 2 == 0:
            neighbours = [
                (column, row - 1),
                (column + 1, row),
                (column, row + 1),
                (column - 1, row + 1),
                (column - 1, row),
                (column - 1, row - 1),
            ]
        else:
            neighbours = [
                (column + 1, row - 1),
                (column + 1, row),
                (column + 1, row + 1),
                (column, row + 1),
                (column - 1, row),
                (column, row - 1),
            ]
        for side, neighbour in enumerate(neighbours):
            if neighbour not in cells:
                draw.line((points[side], points[(side + 1) % 6]), fill=color, width=7)

    glow = perimeter.filter(ImageFilter.GaussianBlur(5))
    glow.putalpha(glow.getchannel("A").point(lambda value: round(value * 0.38)))
    canvas.alpha_composite(glow)
    canvas.alpha_composite(perimeter)


def rounded_panel(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], fill: str, outline: str = "#31484e", radius: int = 12) -> None:
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=1)


def build_scene() -> Path:
    width, height = 1440, 900
    canvas = Image.new("RGBA", (width, height), "#172421")
    terrain_names = ["grass", "meadow", "grass", "forest", "grass", "meadow", "rocks"]

    for row in range(6):
        for column in range(9):
            terrain = terrain_names[(column * 3 + row * 5) % len(terrain_names)]
            paste_at_center(canvas, sprite("environment", terrain), center(column, row))

    river = {
        (4, 0): "river-nw-se",
        (4, 1): "river-nw-se",
        (4, 2): "bridge",
        (4, 3): "river-confluence",
        (4, 4): "river-w-e",
        (4, 5): "river-nw-se",
    }
    for cell, tile in river.items():
        paste_at_center(canvas, sprite("environment", tile), center(*cell))

    for column in range(9):
        tile = "bridge" if column == 4 else "road-t" if column in (2, 6) else "road-w-e"
        paste_at_center(canvas, sprite("environment", tile), center(column, 2))

    buildings = {
        (1, 0): ("buildings", "cottage"),
        (2, 0): ("buildings", "townhouse"),
        (1, 1): ("buildings", "corner-shop"),
        (2, 1): ("buildings", "library"),
        (3, 1): ("stages", "cottage-stage-2"),
        (1, 3): ("stages", "apartments-stage-3"),
        (2, 3): ("buildings", "apartments"),
        (3, 3): ("buildings", "police"),
        (2, 4): ("buildings", "theatre"),
        (6, 0): ("buildings", "apartment-tower"),
        (7, 0): ("buildings", "hotel"),
        (5, 1): ("buildings", "office"),
        (6, 1): ("buildings", "clinic"),
        (7, 1): ("buildings", "school"),
        (6, 3): ("buildings", "gas-station"),
        (7, 3): ("buildings", "workshop"),
        (5, 4): ("stages", "fire-station-stage-1"),
        (6, 4): ("buildings", "fire-station"),
        (7, 4): ("stages", "supermarket-stage-4"),
    }
    for cell, (group, name) in buildings.items():
        paste_at_center(canvas, sprite(group, name), center(*cell))

    districts = [
        ({(1, 0), (2, 0), (1, 1), (2, 1), (3, 1)}, "#49a8e8"),
        ({(1, 3), (2, 3), (3, 3), (2, 4)}, "#ad78df"),
        ({(6, 0), (7, 0), (5, 1), (6, 1), (7, 1)}, "#e9a840"),
        ({(6, 3), (7, 3), (5, 4), (6, 4), (7, 4)}, "#67c86d"),
    ]
    for cells, color in districts:
        draw_district(canvas, cells, color)

    draw = ImageDraw.Draw(canvas)
    draw.rectangle((0, 0, width, 66), fill="#0d191dcc")
    draw.line((0, 65, width, 65), fill="#34474b", width=1)
    draw.text((24, 20), "▦  TASKTOPIA", font=font(20, True), fill="#f0f2e8")
    draw.text((224, 16), "СТРАНА", font=font(9, True), fill="#7e979a")
    draw.text((224, 31), "Product Platform", font=font(14, True), fill="#dce5dd")
    draw.text((850, 24), "●  синхронизировано", font=font(12), fill="#9fc8a0")
    draw.text((1035, 24), "2 города", font=font(12), fill="#afbec0")
    draw.text((1120, 24), "4 района", font=font(12), fill="#afbec0")
    draw.text((1210, 24), "19 задач", font=font(12), fill="#afbec0")
    rounded_panel(draw, (1355, 12, 1423, 52), "#17282c", "#3a5359", 9)
    draw.text((1371, 23), "СТРАНЫ", font=font(9, True), fill="#e5cb68")

    for label, x, y in (("NORTH CITY", 210, 90), ("RIVER CITY", 1030, 90)):
        bbox = draw.textbbox((0, 0), label, font=font(11, True))
        panel = (x - 9, y - 6, x + bbox[2] + 9, y + bbox[3] + 7)
        rounded_panel(draw, panel, "#101c20e8", "#43565b", 6)
        draw.text((x, y), label, font=font(11, True), fill="#f0f2e8")

    rounded_panel(draw, (18, 822, 162, 875), "#101c20e8", "#3b545a", 10)
    draw.text((32, 837), "ГОРОДА", font=font(10, True), fill="#8ea4a7")
    draw.text((32, 851), "2  ·  открыть список", font=font(11), fill="#e2e8df")
    rounded_panel(draw, (1260, 740, 1418, 875), "#101c20e8", "#3b545a", 12)
    draw.text((1276, 757), "КАРТА", font=font(10, True), fill="#8ea4a7")
    draw.text((1276, 782), "+", font=font(24, True), fill="#e4e9df")
    draw.line((1272, 817, 1404, 817), fill="#344b51", width=1)
    draw.text((1279, 829), "−", font=font(25, True), fill="#e4e9df")
    draw.text((1369, 836), "⌖", font=font(20, True), fill="#e4cb64")

    destination = SCREENSHOTS / "generated-sprites-city-v2.png"
    canvas.convert("RGB").save(destination, quality=95)
    return destination


def build_contact_sheet() -> Path:
    manifest = json.loads((ASSETS / "manifest.json").read_text(encoding="utf-8"))
    entries = [(group, entry["key"]) for group, items in manifest["atlases"].items() for entry in items]
    columns = 8
    cell_width, cell_height = 220, 220
    rows = math.ceil(len(entries) / columns)
    sheet = Image.new("RGBA", (columns * cell_width, 70 + rows * cell_height), "#0e181b")
    draw = ImageDraw.Draw(sheet)
    draw.text((24, 19), "TASKTOPIA · GENERATED SPRITE PACK V2", font=font(22, True), fill="#edf0e7")
    draw.text((24, 46), f"{len(entries)} transparent PNG · shared palette · pointy-top hex anchor", font=font(11), fill="#8fa5a8")
    for index, (group, name) in enumerate(entries):
        column = index % columns
        row = index // columns
        x, y = column * cell_width, 70 + row * cell_height
        if index % 2 == 0:
            draw.rectangle((x, y, x + cell_width, y + cell_height), fill="#122126")
        image = sprite(group, name, 176)
        sheet.alpha_composite(image, (x + 22, y + 4))
        draw.text((x + 12, y + 184), name, font=font(10, True), fill="#d5ded8")
        draw.text((x + 12, y + 200), group.upper(), font=font(8, True), fill="#728b8f")
    destination = SCREENSHOTS / "generated-sprite-catalog-v2.png"
    sheet.convert("RGB").save(destination, quality=94)
    return destination


if __name__ == "__main__":
    SCREENSHOTS.mkdir(parents=True, exist_ok=True)
    print(build_scene().relative_to(ROOT))
    print(build_contact_sheet().relative_to(ROOT))
