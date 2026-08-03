"""Normalize AI-authored pixel art into exact pointy-top runtime sprites."""

from __future__ import annotations

import colorsys
import json
import math
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "assets" / "pixel-generated-v3"
SOURCE = PACK / "source"
ENVIRONMENT = PACK / "tiles" / "environment"
BUILDING = PACK / "tiles" / "building"
SCREENSHOTS = ROOT / "screenshots"

# A near-perfect integer regular pointy-top hex. All neighboring edges share
# exactly the same endpoint coordinates when translated by the offsets below.
TILE_SIZE = (167, 193)
HEX_VERTICES = [(83, 0), (166, 48), (166, 144), (83, 192), (0, 144), (0, 48)]
HEX_CENTER = (83, 96)
NEIGHBOUR_OFFSETS = {
    "NE": (83, -144),
    "E": (166, 0),
    "SE": (83, 144),
    "SW": (-83, 144),
    "W": (-166, 0),
    "NW": (-83, -144),
}
EDGE_NAMES = ["NE", "E", "SE", "SW", "W", "NW"]

ENVIRONMENT_NAMES = [
    "grass",
    "meadow",
    "forest",
    "rocks",
    "water",
    "river-straight",
    "river-curve",
    "river-fork",
    "road-straight",
    "road-curve",
    "road-t",
    "bridge",
]

PORT_CONTRACTS = {
    "river-straight": {"water": {"NW", "SE"}},
    "river-curve": {"water": {"W", "NE"}},
    "river-fork": {"water": {"NW", "NE", "SE"}},
    "road-straight": {"road": {"W", "E"}},
    "road-curve": {"road": {"W", "NE"}},
    "road-t": {"road": {"W", "E", "NE"}},
    "bridge": {"road": {"W", "E"}, "water": {"NW", "SE"}},
}


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = "Arial Bold.ttf" if bold else "Arial.ttf"
    return ImageFont.truetype(f"/System/Library/Fonts/Supplemental/{name}", size)


def hex_mask() -> Image.Image:
    mask = Image.new("L", TILE_SIZE, 0)
    ImageDraw.Draw(mask).polygon(HEX_VERTICES, fill=255)
    return mask


HEX_MASK = hex_mask()
SAFE_SAMPLE_MASK = HEX_MASK.filter(ImageFilter.MinFilter(9))


def quantize_rgba(image: Image.Image, colors: int = 64) -> Image.Image:
    alpha = image.getchannel("A")
    quantized = image.quantize(colors=colors, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).convert("RGBA")
    quantized.putalpha(alpha)
    return quantized


def normalize_environment(name: str) -> Image.Image:
    source = Image.open(SOURCE / f"{name}.png").convert("RGBA")
    bbox = source.getchannel("A").getbbox()
    if bbox is None:
        raise RuntimeError(f"{name}: empty source")
    cropped = source.crop(bbox)
    normalized = cropped.resize(TILE_SIZE, Image.Resampling.BOX)
    normalized.putalpha(HEX_MASK)
    normalized = quantize_rgba(normalized, 64)
    normalized.putalpha(HEX_MASK)
    ImageDraw.Draw(normalized).line(HEX_VERTICES + [HEX_VERTICES[0]], fill="#28362c", width=1, joint="curve")
    return normalized


def paste_material(base: Image.Image, material: Image.Image, mask: Image.Image) -> Image.Image:
    return Image.composite(material, base, mask)


def edge_end(edge_name: str, depth: float = 0.12, overshoot: int = 24) -> tuple[tuple[int, int], tuple[int, int]]:
    edge_index = EDGE_NAMES.index(edge_name)
    edge_x, edge_y = edge_midpoint(edge_index)
    inner_x = round(edge_x * (1 - depth) + HEX_CENTER[0] * depth)
    inner_y = round(edge_y * (1 - depth) + HEX_CENTER[1] * depth)
    vector_x, vector_y = edge_x - HEX_CENTER[0], edge_y - HEX_CENTER[1]
    vector_length = math.hypot(vector_x, vector_y)
    outer_x = round(edge_x + vector_x / vector_length * overshoot)
    outer_y = round(edge_y + vector_y / vector_length * overshoot)
    return (outer_x, outer_y), (inner_x, inner_y)


def normalize_outer_ring(sprite: Image.Image, grass: Image.Image) -> Image.Image:
    inside = HEX_MASK.filter(ImageFilter.MinFilter(25))
    ring = ImageChops.subtract(HEX_MASK, inside)
    return paste_material(sprite, grass, ring)


def draw_material_path(base: Image.Image, points: list[tuple[int, int]], widths: list[tuple[int, str | Image.Image]]) -> Image.Image:
    result = base
    for width, material in widths:
        mask = Image.new("L", TILE_SIZE, 0)
        ImageDraw.Draw(mask).line(points, fill=255, width=width, joint="curve")
        mask = ImageChops.multiply(mask, HEX_MASK)
        if isinstance(material, Image.Image):
            result = paste_material(result, material, mask)
        else:
            fill = Image.new("RGBA", TILE_SIZE, material)
            result = paste_material(result, fill, mask)
    return result


def stretch_edge_band(sprite: Image.Image, edge_name: str, band_depth: float = 42.0) -> Image.Image:
    """Pull an authored edge section outward without repainting its materials."""
    edge_index = EDGE_NAMES.index(edge_name)
    ax, ay = HEX_VERTICES[edge_index]
    bx, by = HEX_VERTICES[(edge_index + 1) % 6]
    edge_dx, edge_dy = bx - ax, by - ay
    edge_length = math.hypot(edge_dx, edge_dy)
    inward_x, inward_y = -edge_dy / edge_length, edge_dx / edge_length
    tangent_x, tangent_y = edge_dx / edge_length, edge_dy / edge_length
    midpoint_x, midpoint_y = (ax + bx) / 2, (ay + by) / 2
    source = sprite.copy()
    result = sprite.copy()
    source_pixels = source.load()
    result_pixels = result.load()
    mask_pixels = HEX_MASK.load()
    safe_sample_pixels = SAFE_SAMPLE_MASK.load()

    # Generated rivers are organic and may approach the correct edge slightly
    # off-center. Find the nearest authored water cross-section and pull its
    # center toward the exact runtime port.
    pull = 18.0
    tangent_pull = 0.0
    for candidate_depth in range(8, 37):
        water_offsets: list[int] = []
        for tangent_offset in range(-44, 45):
            sample_x = round(midpoint_x + inward_x * candidate_depth + tangent_x * tangent_offset)
            sample_y = round(midpoint_y + inward_y * candidate_depth + tangent_y * tangent_offset)
            if not (0 <= sample_x < TILE_SIZE[0] and 0 <= sample_y < TILE_SIZE[1]):
                continue
            red, green, blue, alpha = source_pixels[sample_x, sample_y]
            if alpha > 200 and blue > red * 1.35 and blue > green * 1.08:
                water_offsets.append(tangent_offset)
        if len(water_offsets) >= 5:
            pull = float(candidate_depth)
            tangent_pull = sum(water_offsets) / len(water_offsets)
            break

    for y in range(TILE_SIZE[1]):
        for x in range(TILE_SIZE[0]):
            if mask_pixels[x, y] == 0:
                continue
            distance = (edge_dx * (y - ay) - edge_dy * (x - ax)) / edge_length
            if not 0 <= distance <= band_depth:
                continue
            influence = 1.0 - distance / band_depth
            sample_x = min(
                TILE_SIZE[0] - 1,
                max(0, round(x + inward_x * pull * influence + tangent_x * tangent_pull * influence)),
            )
            sample_y = min(
                TILE_SIZE[1] - 1,
                max(0, round(y + inward_y * pull * influence + tangent_y * tangent_pull * influence)),
            )
            sampled = source_pixels[sample_x, sample_y]
            # Never pull transparent pixels from beyond another slanted edge;
            # doing so would become a dark triangle once the shared mask is set.
            if sampled[3] > 200 and safe_sample_pixels[sample_x, sample_y] > 0:
                result_pixels[x, y] = sampled
    return result


def normalize_river(sprite: Image.Image, grass: Image.Image, water: Image.Image, ports: set[str], full_network: bool) -> Image.Image:
    del grass, water, full_network
    result = sprite
    for edge_name in ports:
        result = stretch_edge_band(result, edge_name)
    return result


def draw_dashes(image: Image.Image, start: tuple[int, int], end: tuple[int, int]) -> None:
    draw = ImageDraw.Draw(image)
    dx, dy = end[0] - start[0], end[1] - start[1]
    length = math.hypot(dx, dy)
    if length == 0:
        return
    ux, uy = dx / length, dy / length
    cursor = 5.0
    while cursor < length - 3:
        dash_end = min(cursor + 7, length - 2)
        draw.line(
            (
                round(start[0] + ux * cursor),
                round(start[1] + uy * cursor),
                round(start[0] + ux * dash_end),
                round(start[1] + uy * dash_end),
            ),
            fill="#eee2c5",
            width=2,
        )
        cursor += 13


def normalize_road(sprite: Image.Image, grass: Image.Image, ports: set[str], reset_outer: bool = True) -> Image.Image:
    del grass, reset_outer
    result = sprite
    for edge_name in ports:
        # The source already carries curbs and markings. Extending only asphalt
        # to the shared edge prevents the old pale perpendicular seam.
        outer, curb_inner = edge_end(edge_name, depth=0.10, overshoot=12)
        _, asphalt_inner = edge_end(edge_name, depth=0.18, overshoot=12)
        result = draw_material_path(result, [outer, curb_inner], [(28, "#d3cbb5")])
        result = draw_material_path(result, [outer, asphalt_inner], [(22, "#414646")])
    return result


def normalize_ports(environment: dict[str, Image.Image]) -> None:
    grass = environment["grass"]
    water = environment["water"]
    for name in ("river-straight", "river-curve", "river-fork"):
        environment[name] = normalize_river(
            environment[name],
            grass,
            water,
            PORT_CONTRACTS[name]["water"],
            full_network=True,
        )
    # Horizontal ports are authored accurately. Only the two generated
    # diagonal branches stop short of their NE edge and need a repair.
    environment["road-curve"] = normalize_road(environment["road-curve"], grass, {"NE"})
    environment["road-t"] = normalize_road(environment["road-t"], grass, {"NE"})
    bridge = normalize_river(environment["bridge"], grass, water, PORT_CONTRACTS["bridge"]["water"], full_network=False)
    environment["bridge"] = bridge
    for name in PORT_CONTRACTS:
        ImageDraw.Draw(environment[name]).line(HEX_VERTICES + [HEX_VERTICES[0]], fill="#28362c", width=1)


def split_building_stages() -> list[Image.Image]:
    source = Image.open(SOURCE / "building-stages.png").convert("RGBA")
    cells: list[Image.Image] = []
    bounds: list[tuple[int, int, int, int]] = []
    for index in range(5):
        left = round(index * source.width / 5)
        right = round((index + 1) * source.width / 5)
        cell = source.crop((left, 0, right, source.height))
        bbox = cell.getchannel("A").getbbox()
        if bbox is None:
            raise RuntimeError(f"building stage {index + 1}: empty")
        cells.append(cell)
        bounds.append(bbox)

    top = max(0, min(item[1] for item in bounds) - 10)
    bottom = min(source.height, max(item[3] for item in bounds) + 10)
    result: list[Image.Image] = []
    for index, cell in enumerate(cells):
        cropped = cell.crop((0, top, cell.width, bottom))
        target = Image.new("RGBA", (192, 256), (0, 0, 0, 0))
        scale = min(184 / cropped.width, 226 / cropped.height)
        resized = cropped.resize((round(cropped.width * scale), round(cropped.height * scale)), Image.Resampling.BOX)
        resized = quantize_rgba(resized, 72)
        x = (target.width - resized.width) // 2
        y = 246 - resized.height
        target.alpha_composite(resized, (x, y))
        if target.getchannel("A").getbbox() is None:
            raise RuntimeError(f"building stage {index + 1}: normalization removed content")
        result.append(target)
    return result


def side_lengths() -> list[float]:
    return [round(math.dist(HEX_VERTICES[index], HEX_VERTICES[(index + 1) % 6]), 2) for index in range(6)]


def validate_shared_edges() -> bool:
    opposites = [3, 4, 5, 0, 1, 2]
    for edge_index, edge_name in enumerate(EDGE_NAMES):
        dx, dy = NEIGHBOUR_OFFSETS[edge_name]
        own = {HEX_VERTICES[edge_index], HEX_VERTICES[(edge_index + 1) % 6]}
        opposite = opposites[edge_index]
        other = {
            (HEX_VERTICES[opposite][0] + dx, HEX_VERTICES[opposite][1] + dy),
            (HEX_VERTICES[(opposite + 1) % 6][0] + dx, HEX_VERTICES[(opposite + 1) % 6][1] + dy),
        }
        if own != other:
            return False
    return True


def edge_midpoint(index: int) -> tuple[float, float]:
    a = HEX_VERTICES[index]
    b = HEX_VERTICES[(index + 1) % 6]
    return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)


def port_signal(image: Image.Image, edge_index: int, kind: str) -> float:
    edge_x, edge_y = edge_midpoint(edge_index)
    # Sample slightly inside the tile so the shared one-pixel border does not
    # dominate the material classification.
    sample_x = round(edge_x * 0.95 + HEX_CENTER[0] * 0.05)
    sample_y = round(edge_y * 0.95 + HEX_CENTER[1] * 0.05)
    hits = 0
    total = 0
    for y in range(sample_y - 5, sample_y + 6):
        for x in range(sample_x - 5, sample_x + 6):
            if not (0 <= x < image.width and 0 <= y < image.height):
                continue
            red, green, blue, alpha = image.getpixel((x, y))
            if alpha < 200:
                continue
            total += 1
            hue, saturation, value = colorsys.rgb_to_hsv(red / 255, green / 255, blue / 255)
            if kind == "road" and saturation < 0.28 and value < 0.58:
                hits += 1
            if kind == "water" and blue > red * 1.35 and blue > green * 1.08 and saturation > 0.35:
                hits += 1
    return round(hits / max(1, total), 2)


def axial_top_left(q: int, r: int, origin: tuple[int, int]) -> tuple[int, int]:
    center_x = origin[0] + 166 * q + 83 * r
    center_y = origin[1] + 144 * r
    return center_x - HEX_CENTER[0], center_y - HEX_CENTER[1]


def build_scene(environment: dict[str, Image.Image], stages: list[Image.Image]) -> Path:
    canvas = Image.new("RGBA", (1500, 1150), "#10201eff")
    origin = (750, 560)
    cells: dict[tuple[int, int], str] = {}
    for q in range(-3, 4):
        for r in range(max(-3, -q - 3), min(3, -q + 3) + 1):
            choices = ["grass", "grass", "meadow", "forest", "rocks"]
            cells[(q, r)] = choices[(q * 7 + r * 11) % len(choices)]

    # One connected road and a crossing river. The bridge is their common cell.
    cells[(-3, 0)] = "road-straight"
    cells[(-2, 0)] = "road-straight"
    cells[(-1, 0)] = "road-straight"
    cells[(0, 0)] = "bridge"
    cells[(1, 0)] = "road-straight"
    cells[(2, 0)] = "road-straight"
    cells[(3, 0)] = "road-straight"
    cells[(0, -1)] = "river-straight"
    cells[(0, 1)] = "river-straight"
    cells[(0, -2)] = "river-curve"
    cells[(0, 2)] = "river-fork"

    for (q, r), name in sorted(cells.items(), key=lambda item: (axial_top_left(*item[0], origin)[1], axial_top_left(*item[0], origin)[0])):
        canvas.alpha_composite(environment[name], axial_top_left(q, r, origin))

    # Stage 3 and stage 5 demonstrate that buildings are independent overlays.
    overlays = [((-1, 1), stages[2]), ((2, -1), stages[4])]
    for (q, r), stage in sorted(overlays, key=lambda item: axial_top_left(*item[0], origin)[1]):
        tile_left, tile_top = axial_top_left(q, r, origin)
        world_anchor = (tile_left + HEX_CENTER[0], tile_top + HEX_CENTER[1])
        canvas.alpha_composite(stage, (world_anchor[0] - 96, world_anchor[1] - 218))

    destination = SCREENSHOTS / "pixel-generated-v3-scene.png"
    canvas.convert("RGB").save(destination, quality=95)
    return destination


def build_catalog(environment: dict[str, Image.Image], stages: list[Image.Image]) -> Path:
    width, height = 1600, 1550
    canvas = Image.new("RGBA", (width, height), "#0d1918ff")
    draw = ImageDraw.Draw(canvas)
    draw.text((34, 24), "TASKTOPIA · PIXEL SPRITE PACK V3", font=font(28, True), fill="#edf1e8")
    draw.text((34, 62), "12 exact pointy-top terrain tiles · 5 aligned building stages · generated art + deterministic geometry", font=font(14), fill="#8da49f")
    for index, name in enumerate(ENVIRONMENT_NAMES):
        column = index % 4
        row = index // 4
        x = 30 + column * 390
        y = 110 + row * 360
        preview = environment[name].resize((250, 289), Image.Resampling.NEAREST)
        canvas.alpha_composite(preview, (x + 58, y))
        draw.text((x + 58, y + 298), name, font=font(15, True), fill="#d9e2db")
    stage_y = 1215
    for index, stage in enumerate(stages):
        x = 28 + index * 310
        checker = Image.new("RGBA", (280, 280), "#182927ff")
        checker_draw = ImageDraw.Draw(checker)
        for cy in range(0, 280, 20):
            for cx in range(0, 280, 20):
                if (cx // 20 + cy // 20) % 2:
                    checker_draw.rectangle((cx, cy, cx + 19, cy + 19), fill="#203633")
        canvas.alpha_composite(checker, (x, stage_y))
        preview = stage.resize((210, 280), Image.Resampling.NEAREST)
        canvas.alpha_composite(preview, (x + 35, stage_y))
        draw.text((x, stage_y + 290), f"building-stage-{index + 1}", font=font(14, True), fill="#d9e2db")
    destination = SCREENSHOTS / "pixel-generated-v3-catalog.png"
    canvas.convert("RGB").save(destination, quality=95)
    return destination


def main() -> None:
    ENVIRONMENT.mkdir(parents=True, exist_ok=True)
    BUILDING.mkdir(parents=True, exist_ok=True)
    SCREENSHOTS.mkdir(parents=True, exist_ok=True)

    environment: dict[str, Image.Image] = {}
    for name in ENVIRONMENT_NAMES:
        sprite = normalize_environment(name)
        environment[name] = sprite

    normalize_ports(environment)
    alpha_reference: bytes | None = None
    for name, sprite in environment.items():
        sprite.putalpha(HEX_MASK)
        alpha = sprite.getchannel("A").tobytes()
        if alpha_reference is None:
            alpha_reference = alpha
        elif alpha != alpha_reference:
            raise RuntimeError(f"{name}: normalized alpha differs from shared geometry")
        sprite.save(ENVIRONMENT / f"{name}.png", optimize=True)

    stages = split_building_stages()
    for index, stage in enumerate(stages, start=1):
        stage.save(BUILDING / f"townhouse-stage-{index}.png", optimize=True)

    lengths = side_lengths()
    if not validate_shared_edges():
        raise RuntimeError("pointy-top neighboring edges do not meet exactly")
    port_report = {
        name: {
            kind: {edge: port_signal(environment[name], EDGE_NAMES.index(edge), kind) for edge in EDGE_NAMES}
            for kind in contract
        }
        for name, contract in PORT_CONTRACTS.items()
    }
    for name, contract in PORT_CONTRACTS.items():
        for kind, expected_edges in contract.items():
            signals = port_report[name][kind]
            for edge_name, signal in signals.items():
                minimum_signal = 0.50 if kind == "road" else 0.60
                if edge_name in expected_edges and signal < minimum_signal:
                    raise RuntimeError(f"{name}: weak {kind} port at {edge_name}: {signal}")
                if edge_name not in expected_edges and signal > 0.20:
                    raise RuntimeError(f"{name}: accidental {kind} port at {edge_name}: {signal}")
    manifest = {
        "version": 3,
        "style": "premium low-resolution city-builder pixel art",
        "orientation": "POINTY_TOP",
        "terrain": {
            "spriteSize": list(TILE_SIZE),
            "vertices": HEX_VERTICES,
            "center": list(HEX_CENTER),
            "neighbourOffsets": {key: list(value) for key, value in NEIGHBOUR_OFFSETS.items()},
            "files": [f"tiles/environment/{name}.png" for name in ENVIRONMENT_NAMES],
        },
        "building": {
            "key": "townhouse",
            "spriteSize": [192, 256],
            "anchor": [96, 218],
            "footprint": [[0, 0]],
            "files": [f"tiles/building/townhouse-stage-{index}.png" for index in range(1, 6)],
            "containsTerrain": False,
        },
        "validation": {
            "terrainCount": len(environment),
            "buildingStageCount": len(stages),
            "identicalTerrainAlphaGeometry": True,
            "allSixNeighbourEdgesMeetExactly": True,
            "sideLengthsPx": lengths,
            "sideLengthSpreadPx": round(max(lengths) - min(lengths), 2),
            "portContractsPass": True,
            "portSignals": port_report,
        },
        "provenance": {
            "art": "built-in image generation, one source per terrain concept and one five-stage strip",
            "runtimeGeometry": "deterministic normalization by scripts/process-pixel-generated-v3.py",
        },
    }
    (PACK / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    catalog = build_catalog(environment, stages)
    scene = build_scene(environment, stages)
    print(json.dumps(manifest["validation"], ensure_ascii=False))
    print(catalog.relative_to(ROOT))
    print(scene.relative_to(ROOT))


if __name__ == "__main__":
    main()
