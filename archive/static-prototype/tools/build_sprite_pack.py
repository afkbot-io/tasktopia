from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "assets" / "hex-sprite-pack-v1"
SOURCE = PACK / "source"

TILE_SIZE = (256, 222)
OBJECT_SIZE = (320, 384)
OBJECT_TILE_ORIGIN = (32, 154)


def split_grid(image: Image.Image, columns: int, rows: int) -> list[Image.Image]:
    frames: list[Image.Image] = []
    for row in range(rows):
        for column in range(columns):
            left = round(column * image.width / columns)
            right = round((column + 1) * image.width / columns)
            top = round(row * image.height / rows)
            bottom = round((row + 1) * image.height / rows)
            frames.append(image.crop((left, top, right, bottom)))
    return frames


def exact_hex_mask(size: tuple[int, int]) -> Image.Image:
    width, height = size
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    quarter = width // 4
    draw.polygon(
        [
            (quarter, 0),
            (width - quarter - 1, 0),
            (width - 1, height // 2),
            (width - quarter - 1, height - 1),
            (quarter, height - 1),
            (0, height // 2),
        ],
        fill=255,
    )
    return mask


def normalized_tile(frame: Image.Image) -> Image.Image:
    bbox = frame.getchannel("A").getbbox()
    if bbox is None:
        raise ValueError("Frame has no visible pixels")
    tile = frame.crop(bbox).resize(TILE_SIZE, Image.Resampling.NEAREST)
    alpha = Image.composite(tile.getchannel("A"), Image.new("L", TILE_SIZE, 0), exact_hex_mask(TILE_SIZE))
    tile.putalpha(alpha)
    return tile


def object_frame(tile: Image.Image) -> Image.Image:
    canvas = Image.new("RGBA", OBJECT_SIZE, (0, 0, 0, 0))
    canvas.alpha_composite(tile, OBJECT_TILE_ORIGIN)
    return canvas


def save_tiles(source_name: str, destinations: list[Path], columns: int, rows: int) -> list[Image.Image]:
    image = Image.open(SOURCE / source_name).convert("RGBA")
    frames = split_grid(image, columns, rows)
    if len(frames) != len(destinations):
        raise ValueError("Destination count does not match atlas frame count")
    results: list[Image.Image] = []
    for frame, destination in zip(frames, destinations, strict=True):
        tile = normalized_tile(frame)
        destination.parent.mkdir(parents=True, exist_ok=True)
        tile.save(destination, optimize=True)
        results.append(tile)
    return results


def save_building(source_name: str, folder: str) -> list[Image.Image]:
    names = [
        "stage-01-planning.png",
        "stage-02-foundation.png",
        "stage-03-construction.png",
        "stage-04-finishing.png",
        "stage-05-complete.png",
    ]
    image = Image.open(SOURCE / source_name).convert("RGBA")
    results: list[Image.Image] = []
    for frame, name in zip(split_grid(image, 5, 1), names, strict=True):
        sprite = object_frame(normalized_tile(frame))
        destination = PACK / "buildings" / folder / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        sprite.save(destination, optimize=True)
        results.append(sprite)
    return results


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def checkerboard(size: tuple[int, int], cell: int = 24) -> Image.Image:
    canvas = Image.new("RGBA", size, "#172125")
    draw = ImageDraw.Draw(canvas)
    for y in range(0, size[1], cell):
        for x in range(0, size[0], cell):
            if (x // cell + y // cell) % 2:
                draw.rectangle((x, y, x + cell - 1, y + cell - 1), fill="#1d2a2e")
    return canvas


def centered_preview(image: Image.Image, box: tuple[int, int], maximum: tuple[int, int]) -> tuple[Image.Image, tuple[int, int]]:
    visible = image.getbbox()
    crop = image.crop(visible) if visible else image
    scale = min(maximum[0] / crop.width, maximum[1] / crop.height)
    resized = crop.resize((round(crop.width * scale), round(crop.height * scale)), Image.Resampling.NEAREST)
    position = (box[0] + (maximum[0] - resized.width) // 2, box[1] + (maximum[1] - resized.height) // 2)
    return resized, position


def make_contact_sheet(
    terrain: list[Image.Image], roads: list[Image.Image], residential: list[Image.Image], shop: list[Image.Image]
) -> None:
    canvas = checkerboard((1920, 1220), 30)
    draw = ImageDraw.Draw(canvas)
    title_font = font(40, True)
    section_font = font(25, True)
    label_font = font(18)
    muted = "#9eb0b5"
    draw.text((64, 44), "TASKTOPIA · HEX SPRITE PACK V1", font=title_font, fill="#f4f0df")
    draw.text((64, 98), "Flat-top · exact 256 × 222 base · transparent PNG · nearest-neighbour ready", font=label_font, fill=muted)

    sections = [
        ("TERRAIN", terrain, ["grass", "grass tufts", "meadow", "water calm", "water ripples", "water waves"], 160),
        ("ROADS", roads, ["end E", "straight E–W", "straight NW–SE", "turn W–NE", "T junction", "six-way"], 420),
        ("RESIDENTIAL · 5 TASK STATES", residential, ["planning", "foundation", "construction", "finishing", "complete"], 680),
        ("SHOP HOUSE · 5 TASK STATES", shop, ["planning", "foundation", "construction", "finishing", "complete"], 950),
    ]
    for heading, images, labels, y in sections:
        draw.text((64, y), heading, font=section_font, fill="#f2c84b")
        columns = len(images)
        cell_width = 280 if columns == 6 else 335
        for index, (sprite, label) in enumerate(zip(images, labels, strict=True)):
            x = 64 + index * cell_width
            draw.rounded_rectangle((x, y + 42, x + cell_width - 18, y + 224), radius=14, fill="#10181bcc", outline="#395057", width=2)
            preview, position = centered_preview(sprite, (x + 16, y + 53), (cell_width - 50, 142))
            canvas.alpha_composite(preview, position)
            draw.text((x + 16, y + 198), label, font=label_font, fill="#d8e1e2")
    canvas.convert("RGB").save(PACK / "preview.png", quality=94)


def make_map_preview(terrain: list[Image.Image], roads: list[Image.Image], residential: list[Image.Image], shop: list[Image.Image]) -> None:
    canvas = Image.new("RGBA", (1420, 920), "#0c1518")
    draw = ImageDraw.Draw(canvas)
    draw.text((44, 34), "IN-GAME SCALE CHECK", font=font(32, True), fill="#f4f0df")
    draw.text((44, 76), "The grid is top-down. Buildings keep the same hex footprint and anchor.", font=font(18), fill="#98abb0")

    origin_x, origin_y = 100, 130
    cols, rows = 7, 3
    for column in range(cols):
        for row in range(rows):
            x = origin_x + column * 192
            y = origin_y + row * 222 + (column % 2) * 111
            tile = terrain[(column * 3 + row) % 3]
            canvas.alpha_composite(tile, (x, y))

    # NW–SE follows edge-adjacent cells in this odd-column flat-top layout.
    road_cells = [(0, 0), (1, 0), (2, 1), (3, 1), (4, 2), (5, 2)]
    for column, row in road_cells:
        x = origin_x + column * 192
        y = origin_y + row * 222 + (column % 2) * 111
        canvas.alpha_composite(roads[2], (x, y))

    building_positions = [
        (residential[4], origin_x + 2 * 192 - 32, origin_y + 0 * 222 - 154),
        (shop[4], origin_x + 5 * 192 - 32, origin_y + 1 * 222 + 111 - 154),
    ]
    for sprite, x, y in building_positions:
        canvas.alpha_composite(sprite, (x, y))

    draw.rounded_rectangle((44, 820, 1376, 878), radius=12, fill="#111c20e6", outline="#3b5158", width=2)
    draw.text((66, 839), "Terrain: 256×222  ·  Object frame: 320×384  ·  Anchor: (160, 376)  ·  Footprint: one flat-top hex", font=font(20), fill="#d9e4e5")
    canvas.convert("RGB").save(PACK / "preview-map.png", quality=94)


def main() -> None:
    terrain_paths = [
        PACK / "terrain" / "grass-plain.png",
        PACK / "terrain" / "grass-tufts.png",
        PACK / "terrain" / "grass-meadow.png",
        PACK / "terrain" / "water-calm.png",
        PACK / "terrain" / "water-ripples.png",
        PACK / "terrain" / "water-waves.png",
    ]
    road_paths = [
        PACK / "roads" / "road-end-e.png",
        PACK / "roads" / "road-straight-ew.png",
        PACK / "roads" / "road-straight-nw-se.png",
        PACK / "roads" / "road-turn-w-ne.png",
        PACK / "roads" / "road-t-w-e-sw.png",
        PACK / "roads" / "road-intersection-6.png",
    ]
    terrain = save_tiles("terrain-atlas.png", terrain_paths, 3, 2)
    roads = save_tiles("roads-atlas.png", road_paths, 3, 2)
    residential = save_building("building-residential-atlas.png", "residential")
    shop = save_building("building-shop-atlas.png", "shop")
    make_contact_sheet(terrain, roads, residential, shop)
    make_map_preview(terrain, roads, residential, shop)


if __name__ == "__main__":
    main()
