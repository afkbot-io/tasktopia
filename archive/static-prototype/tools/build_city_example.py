from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "assets" / "hex-sprite-pack-v1"
OUTPUT = PACK / "examples" / "small-city.png"

TILE_W = 256
TILE_H = 222
STEP_X = 192
STEP_Y = 222
ORIGIN = (92, 126)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def load(path: str) -> Image.Image:
    return Image.open(PACK / path).convert("RGBA")


def tile_position(column: int, row: int) -> tuple[int, int]:
    x = ORIGIN[0] + column * STEP_X
    y = ORIGIN[1] + row * STEP_Y + (column % 2) * TILE_H // 2
    return x, y


def hex_points(column: int, row: int) -> list[tuple[int, int]]:
    x, y = tile_position(column, row)
    return [
        (x + 64, y),
        (x + 191, y),
        (x + 255, y + 111),
        (x + 191, y + 221),
        (x + 64, y + 221),
        (x, y + 111),
    ]


def badge(canvas: Image.Image, column: int, row: int, label: str, color: str) -> None:
    draw = ImageDraw.Draw(canvas)
    x, y = tile_position(column, row)
    center = (x + 212, y + 34)
    draw.ellipse((center[0] - 27, center[1] - 27, center[0] + 27, center[1] + 27), fill="#102025e8", outline=color, width=4)
    text_font = font(15, True)
    bounds = draw.textbbox((0, 0), label, font=text_font)
    draw.text((center[0] - (bounds[2] - bounds[0]) / 2, center[1] - (bounds[3] - bounds[1]) / 2 - 1), label, font=text_font, fill="#ffffff")


def main() -> None:
    canvas = Image.new("RGBA", (1600, 1160), "#0c1518")
    draw = ImageDraw.Draw(canvas)

    # App-style header keeps the scene readable while leaving the map itself unobstructed.
    draw.rounded_rectangle((28, 24, 1572, 96), radius=14, fill="#111d21f2", outline="#32464c", width=2)
    draw.text((54, 43), "TASKTOPIA", font=font(27, True), fill="#f2f0e5")
    draw.text((240, 47), "Riverside · Sprint 07", font=font(21, True), fill="#f0c84b")
    draw.text((1080, 48), "10 TASKS", font=font(18, True), fill="#d8e4e5")
    draw.text((1214, 48), "3 ACTIVE", font=font(18, True), fill="#f0c84b")
    draw.text((1366, 48), "38 SP", font=font(18, True), fill="#8ed27c")

    terrain = [
        load("terrain/grass-plain.png"),
        load("terrain/grass-tufts.png"),
        load("terrain/grass-meadow.png"),
    ]
    water = [
        load("terrain/water-calm.png"),
        load("terrain/water-ripples.png"),
        load("terrain/water-waves.png"),
    ]
    road = load("roads/road-straight-nw-se.png")

    columns, rows = 7, 4
    water_cells = {(6, 0), (6, 1), (6, 2), (6, 3), (5, 0)}
    road_cells = {(0, 1), (1, 1), (2, 2), (3, 2), (4, 3), (5, 3)}
    building_cells = {
        (1, 0): ("buildings/residential/stage-05-complete.png", None),
        (2, 0): ("buildings/shop/stage-05-complete.png", None),
        (3, 0): ("buildings/residential/stage-04-finishing.png", ("80%", "#55a8dc")),
        (4, 0): ("buildings/shop/stage-02-foundation.png", ("20%", "#dba941")),
        (0, 2): ("buildings/shop/stage-01-planning.png", ("PLAN", "#a983d9")),
        (1, 2): ("buildings/residential/stage-03-construction.png", ("45%", "#f0c84b")),
        (3, 1): ("buildings/shop/stage-05-complete.png", None),
        (4, 1): ("buildings/residential/stage-05-complete.png", None),
        (5, 1): ("buildings/shop/stage-03-construction.png", ("55%", "#f0c84b")),
        (2, 3): ("buildings/residential/stage-02-foundation.png", ("15%", "#dba941")),
    }

    # Base terrain layer.
    for column in range(columns):
        for row in range(rows):
            x, y = tile_position(column, row)
            if (column, row) in water_cells:
                sprite = water[(column + row) % len(water)]
            else:
                sprite = terrain[(column * 2 + row) % len(terrain)]
            canvas.alpha_composite(sprite, (x, y))

    # Connected NW–SE arterial road.
    for column, row in sorted(road_cells, key=lambda item: tile_position(*item)[1]):
        canvas.alpha_composite(road, tile_position(column, row))

    # A subtle sprint perimeter around the developed part of the map.
    for column in range(0, 6):
        for row in range(rows):
            draw.line(hex_points(column, row) + [hex_points(column, row)[0]], fill="#e4bd3c66", width=2)

    # Object frames are larger than a tile. Sorting by baseline makes future tall buildings overlap correctly.
    ordered_buildings = sorted(building_cells.items(), key=lambda item: tile_position(*item[0])[1] + TILE_H)
    for (column, row), (path, _) in ordered_buildings:
        sprite = load(path)
        tile_x, tile_y = tile_position(column, row)
        canvas.alpha_composite(sprite, (tile_x - 32, tile_y - 154))

    for (column, row), (_, marker) in building_cells.items():
        if marker:
            badge(canvas, column, row, marker[0], marker[1])

    # Status legend / task summary.
    draw.rounded_rectangle((46, 1015, 1554, 1126), radius=16, fill="#101c20f2", outline="#3a5057", width=2)
    draw.text((72, 1040), "SPRINT PROGRESS", font=font(17, True), fill="#91a6aa")
    draw.text((72, 1070), "Riverside service district", font=font(24, True), fill="#f2f0e5")
    legend = [
        ("#a983d9", "Planning 1"),
        ("#dba941", "Foundation 2"),
        ("#f0c84b", "Construction 2"),
        ("#55a8dc", "Finishing 1"),
        ("#78bd69", "Complete 4"),
    ]
    x = 560
    for color, label in legend:
        draw.rounded_rectangle((x, 1052, x + 18, 1070), radius=4, fill=color)
        draw.text((x + 28, 1049), label, font=font(17), fill="#d8e2e4")
        x += 185

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(OUTPUT, quality=95)
    print(OUTPUT)


if __name__ == "__main__":
    main()
