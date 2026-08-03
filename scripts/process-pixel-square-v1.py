"""Normalize generated art into exact square top-down tiles with N/E/S/W ports."""

from __future__ import annotations

import colorsys
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "assets" / "pixel-square-v1"
SOURCE = PACK / "source"
TILES = PACK / "tiles"
SCREENSHOTS = ROOT / "screenshots"
SIZE = 192
CENTER = SIZE // 2
SIDES = ("N", "E", "S", "W")


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = "Arial Bold.ttf" if bold else "Arial.ttf"
    return ImageFont.truetype(f"/System/Library/Fonts/Supplemental/{name}", size)


def normalize_source(name: str) -> Image.Image:
    image = Image.open(SOURCE / f"{name}.png").convert("RGB")
    # Drop the occasional one-pixel generator fringe while preserving every
    # edge-to-edge transport path.
    margin = 12
    image = image.crop((margin, margin, image.width - margin, image.height - margin))
    image = image.resize((SIZE, SIZE), Image.Resampling.BOX)
    image = image.quantize(colors=112, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).convert("RGBA")
    image.putalpha(255)
    return image


def material_pixel(pixel: tuple[int, int, int, int], kind: str) -> bool:
    red, green, blue, alpha = pixel
    if alpha < 200:
        return False
    hue, saturation, value = colorsys.rgb_to_hsv(red / 255, green / 255, blue / 255)
    if kind == "road":
        return saturation < 0.24 and value < 0.48
    if kind == "water":
        return blue > red * 1.25 and blue > green * 1.03 and saturation > 0.18
    raise ValueError(kind)


def edge_point(side: str, tangent: int, inset: int) -> tuple[int, int]:
    if side == "N":
        return tangent, inset
    if side == "E":
        return SIZE - 1 - inset, tangent
    if side == "S":
        return tangent, SIZE - 1 - inset
    return inset, tangent


def detect_port_center(image: Image.Image, side: str, kind: str) -> float:
    hits: list[int] = []
    for inset in range(2, 10):
        current = [tangent for tangent in range(SIZE) if material_pixel(image.getpixel(edge_point(side, tangent, inset)), kind)]
        if len(current) >= 6:
            hits.extend(current)
            break
    if not hits:
        raise RuntimeError(f"no {kind} material found near {side} edge")
    return sum(hits) / len(hits)


def normalize_port(image: Image.Image, side: str, kind: str, band: int = 56) -> Image.Image:
    detected = detect_port_center(image, side, kind)
    shift = detected - CENTER
    if abs(shift) < 0.5:
        return image
    source = image.copy()
    result = image.copy()
    src = source.load()
    dst = result.load()
    for depth in range(band):
        influence = 1.0 - depth / band
        tangent_shift = shift * influence
        for tangent in range(SIZE):
            sample_tangent = min(SIZE - 1, max(0, round(tangent + tangent_shift)))
            x, y = edge_point(side, tangent, depth)
            sx, sy = edge_point(side, sample_tangent, depth)
            dst[x, y] = src[sx, sy]
    return result


def with_ports(image: Image.Image, contract: dict[str, set[str]]) -> Image.Image:
    result = image
    for kind, sides in contract.items():
        for side in sides:
            result = normalize_port(result, side, kind)
    return result


def rotations(prefix: str, base: Image.Image, base_ports: tuple[str, str]) -> dict[str, Image.Image]:
    result: dict[str, Image.Image] = {}
    ports = list(base_ports)
    image = base
    for _ in range(4):
        key = "".join(sorted(ports, key=SIDES.index)).lower()
        result[f"{prefix}-{key}"] = image
        image = image.rotate(-90, resample=Image.Resampling.NEAREST)
        ports = [SIDES[(SIDES.index(port) + 1) % 4] for port in ports]
    return result


def port_signal(image: Image.Image, side: str, kind: str) -> float:
    hits = 0
    total = 0
    for depth in range(3, 10):
        for tangent in range(CENTER - 7, CENTER + 8):
            total += 1
            if material_pixel(image.getpixel(edge_point(side, tangent, depth)), kind):
                hits += 1
    return round(hits / total, 2)


def polish_contract_edges(
    image: Image.Image,
    grass: Image.Image,
    contract: dict[str, set[str]],
    depth: int = 8,
    port_half_width: int = 30,
) -> Image.Image:
    """Replace generator fringes while preserving exact transport openings."""
    result = image.copy()
    result_pixels = result.load()
    grass_pixels = grass.load()
    port_sides = {side for sides in contract.values() for side in sides}
    for side in SIDES:
        for inset in range(depth):
            for tangent in range(SIZE):
                preserve_port = side in port_sides and abs(tangent - CENTER) <= port_half_width
                if preserve_port:
                    continue
                x, y = edge_point(side, tangent, inset)
                result_pixels[x, y] = grass_pixels[x, y]
    return result


def build_tiles() -> tuple[dict[str, Image.Image], dict[str, dict[str, set[str]]]]:
    tiles = {name: normalize_source(name) for name in ("grass", "forest", "rocks", "water", "building")}
    contracts: dict[str, dict[str, set[str]]] = {}

    road_ew = with_ports(normalize_source("road-straight"), {"road": {"E", "W"}})
    tiles["road-ew"] = road_ew
    contracts["road-ew"] = {"road": {"E", "W"}}
    tiles["road-ns"] = road_ew.rotate(90, resample=Image.Resampling.NEAREST)
    contracts["road-ns"] = {"road": {"N", "S"}}

    road_wn = with_ports(normalize_source("road-curve"), {"road": {"W", "N"}})
    road_curves = rotations("road", road_wn, ("W", "N"))
    tiles.update(road_curves)
    for name in road_curves:
        contracts[name] = {"road": set(name.split("-")[1].upper())}

    river_ns = with_ports(normalize_source("river-straight"), {"water": {"N", "S"}})
    tiles["river-ns"] = river_ns
    contracts["river-ns"] = {"water": {"N", "S"}}
    tiles["river-ew"] = river_ns.rotate(90, resample=Image.Resampling.NEAREST)
    contracts["river-ew"] = {"water": {"E", "W"}}

    river_ne = with_ports(normalize_source("river-curve"), {"water": {"N", "E"}})
    river_curves = rotations("river", river_ne, ("N", "E"))
    tiles.update(river_curves)
    for name in river_curves:
        contracts[name] = {"water": set(name.split("-")[1].upper())}

    bridge = with_ports(normalize_source("bridge"), {"road": {"E", "W"}, "water": {"N", "S"}})
    tiles["bridge-ew-ns"] = bridge
    contracts["bridge-ew-ns"] = {"road": {"E", "W"}, "water": {"N", "S"}}
    for name, contract in contracts.items():
        tiles[name] = polish_contract_edges(tiles[name], tiles["grass"], contract)
    return tiles, contracts


def validate(tiles: dict[str, Image.Image], contracts: dict[str, dict[str, set[str]]]) -> dict[str, object]:
    report: dict[str, object] = {}
    for name, contract in contracts.items():
        signals: dict[str, dict[str, float]] = {}
        for kind, expected in contract.items():
            signals[kind] = {side: port_signal(tiles[name], side, kind) for side in SIDES}
            for side in expected:
                if signals[kind][side] < 0.55:
                    raise RuntimeError(f"{name}: weak {kind} port {side}: {signals[kind][side]}")
        report[name] = signals
    return {
        "camera": "ORTHOGRAPHIC_TOP_DOWN_90_DEGREES",
        "tileSize": [SIZE, SIZE],
        "tileCount": len(tiles),
        "grid": "SQUARE_4_NEIGHBOUR",
        "portCoordinatePx": CENTER,
        "portContractsPass": True,
        "portSignals": report,
    }


def build_scene(tiles: dict[str, Image.Image]) -> Path:
    columns, rows = 8, 6
    canvas = Image.new("RGBA", (columns * SIZE, rows * SIZE), "#14201dff")
    terrain_cycle = ["grass", "grass", "grass", "forest", "rocks"]
    cells: dict[tuple[int, int], str] = {}
    for y in range(rows):
        for x in range(columns):
            cells[(x, y)] = terrain_cycle[(x * 7 + y * 11) % len(terrain_cycle)]

    # One exact N/S river and one exact E/W road intersect on a bridge.
    for y in range(rows):
        cells[(4, y)] = "river-ns"
    for x in range(columns):
        cells[(x, 3)] = "road-ew"
    cells[(4, 3)] = "bridge-ew-ns"
    cells[(2, 1)] = "building"

    # Two authored curve samples, each with exact midpoint ports.
    cells[(0, 0)] = "river-ne"
    cells[(1, 0)] = "river-ew"
    cells[(5, 5)] = "road-ew"
    cells[(6, 5)] = "road-ew"
    cells[(7, 5)] = "road-nw"
    cells[(7, 4)] = "road-ns"

    for (x, y), name in cells.items():
        canvas.alpha_composite(tiles[name], (x * SIZE, y * SIZE))

    draw = ImageDraw.Draw(canvas, "RGBA")
    draw.rounded_rectangle((28, 26, 590, 102), radius=14, fill=(12, 28, 25, 232), outline=(79, 109, 100, 255), width=2)
    draw.text((48, 41), "SQUARE GRID · 4 PORTS", font=font(22, True), fill="#eef3ed")
    draw.text((48, 72), "N / E / S / W · deterministic connections", font=font(14), fill="#a5b6b0")
    destination = SCREENSHOTS / "pixel-square-v1-scene.png"
    canvas.convert("RGB").save(destination, quality=95)
    return destination


def build_catalog(tiles: dict[str, Image.Image]) -> Path:
    names = list(tiles)
    columns = 5
    rows = (len(names) + columns - 1) // columns
    cell_w, cell_h = 260, 255
    canvas = Image.new("RGBA", (columns * cell_w + 40, rows * cell_h + 130), "#0d1918ff")
    draw = ImageDraw.Draw(canvas)
    draw.text((30, 24), "SQUARE PIXEL TILESET · V1", font=font(28, True), fill="#eef3ed")
    draw.text((30, 64), "strict top-down · 192×192 · exact midpoint ports", font=font(15), fill="#9fb1aa")
    for index, name in enumerate(names):
        x = 28 + index % columns * cell_w
        y = 105 + index // columns * cell_h
        preview = tiles[name].resize((210, 210), Image.Resampling.NEAREST)
        canvas.alpha_composite(preview, (x, y))
        draw.text((x, y + 216), name, font=font(14, True), fill="#dfe8e2")
    destination = SCREENSHOTS / "pixel-square-v1-catalog.png"
    canvas.convert("RGB").save(destination, quality=95)
    return destination


def main() -> None:
    TILES.mkdir(parents=True, exist_ok=True)
    SCREENSHOTS.mkdir(parents=True, exist_ok=True)
    tiles, contracts = build_tiles()
    for name, tile in tiles.items():
        tile.save(TILES / f"{name}.png", optimize=True)
    validation = validate(tiles, contracts)
    manifest = {
        "version": 1,
        "projection": "strict vertical orthographic",
        "grid": "SQUARE_4_NEIGHBOUR",
        "tileSize": [SIZE, SIZE],
        "portCoordinatePx": CENTER,
        "files": [f"tiles/{name}.png" for name in tiles],
        "contracts": {name: {kind: sorted(sides) for kind, sides in contract.items()} for name, contract in contracts.items()},
        "validation": validation,
        "provenance": {
            "art": "built-in image generation; one call per base concept; grass used as style anchor",
            "runtime": "deterministic resize, edge-port normalization and rotations by scripts/process-pixel-square-v1.py",
        },
    }
    (PACK / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    catalog = build_catalog(tiles)
    scene = build_scene(tiles)
    print(json.dumps({key: validation[key] for key in ("tileCount", "grid", "portCoordinatePx", "portContractsPass")}, ensure_ascii=False))
    print(catalog.relative_to(ROOT))
    print(scene.relative_to(ROOT))


if __name__ == "__main__":
    main()
