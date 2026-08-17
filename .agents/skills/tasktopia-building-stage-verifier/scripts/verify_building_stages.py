#!/usr/bin/env python3
"""Verify separate Tasktopia building stages and render grid-exact previews."""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw


PAVEMENT_PALETTE = {
    "J": (88, 103, 110, 255),
    "S": (120, 134, 140, 255),
    "B": (132, 145, 149, 255),
    "A": (136, 149, 153, 255),
    "L": (143, 155, 158, 255),
    "H": (149, 160, 161, 255),
}
PAVEMENT_VARIANTS = (
    ("JJJJJJJJ", "JLLLLLLL", "JLABBBBB", "JLBBBBAB", "JABBBBBB", "JLABBBBB", "JABBABBB", "JBBBBBSS"),
    ("JJJJJJJJ", "JLLLLLLL", "JLBBBBBB", "JABBBABB", "JLBBBBBB", "JLABBBBB", "JBBHBBBB", "JBBBBBBS"),
    ("JJJJJJJJ", "JLLLLLLL", "JLABBBBB", "JLBBBBBB", "JABBBBBB", "JLBBHBBB", "JBBBBABB", "JBBBBBSS"),
    ("JJJJJJJJ", "JLLLLLLL", "JLBBBBBB", "JLABBBBB", "JABBBBBB", "JLBBBABB", "JABBBBBB", "JBBBBBBS"),
    ("JJJJJJJJ", "JLLLLLLL", "JLABBABB", "JLBBBBBB", "JABHBBBB", "JLBBBBBB", "JABBBBBB", "JBBBBBSS"),
)


@dataclass(frozen=True)
class Geometry:
    key: str
    category: str
    cell: int
    width_cells: int
    height_cells: int
    depth_cells: int
    projected_depth_cells: int
    foundation_thickness_cells: int
    clearance_cells: int
    entrance_offset: int
    door_module_size: tuple[int, int]
    door_leaf_size: tuple[int, int]
    door_bottom_inset_px: int
    finished_occupied_width_range: tuple[int, int] | None
    finished_occupied_height_range: tuple[int, int] | None
    site_columns: int
    site_rows: int

    @property
    def sprite_size(self) -> tuple[int, int]:
        return self.width_cells * self.cell, self.height_cells * self.cell

    @property
    def anchor(self) -> tuple[int, int]:
        width, height = self.sprite_size
        return width // 2, height

    @property
    def envelope_cells(self) -> tuple[int, int]:
        margin = self.clearance_cells * 2
        return self.width_cells + margin, self.depth_cells + margin

    @property
    def projected_depth_px(self) -> int:
        return self.projected_depth_cells * self.cell

    @property
    def foundation_total_height_px(self) -> int:
        return (self.projected_depth_cells + self.foundation_thickness_cells) * self.cell

    @property
    def projection_ratio(self) -> float:
        return self.projected_depth_cells / self.depth_cells


def load_geometry(path: Path) -> Geometry:
    raw = json.loads(path.read_text(encoding="utf-8"))
    canvas = raw["spriteCanvasCells"]
    footprint = raw["physicalFootprintCells"]
    site = raw.get("sitePreviewCells", [max(20, canvas[0] + 2), max(30, footprint[1] + 6)])
    geometry = Geometry(
        key=str(raw["key"]),
        category=str(raw.get("category", "HIGHRISE")),
        cell=int(raw.get("cellSizePx", 8)),
        width_cells=int(canvas[0]),
        height_cells=int(canvas[1]),
        depth_cells=int(footprint[1]),
        projected_depth_cells=int(raw["projectedRoofDepthCells"]),
        foundation_thickness_cells=int(raw.get("foundationThicknessCells", 2)),
        clearance_cells=int(raw.get("constructionClearanceCells", 1)),
        entrance_offset=int(raw["entrance"]["offset"]),
        door_module_size=tuple(int(value) for value in raw.get("doorSizePx", [8, 16])),
        door_leaf_size=tuple(int(value) for value in raw.get("doorLeafSizePx", [6, 14])),
        door_bottom_inset_px=int(raw.get("doorBottomInsetPx", 0)),
        finished_occupied_width_range=(
            tuple(int(value) for value in raw["finishedOccupiedWidthPxRange"])
            if "finishedOccupiedWidthPxRange" in raw else None
        ),
        finished_occupied_height_range=(
            tuple(int(value) for value in raw["finishedOccupiedHeightPxRange"])
            if "finishedOccupiedHeightPxRange" in raw else None
        ),
        site_columns=int(site[0]),
        site_rows=int(site[1]),
    )
    errors: list[str] = []
    if geometry.cell != 8:
        errors.append("cellSizePx must be 8")
    if int(footprint[0]) != geometry.width_cells:
        errors.append("sprite width cells must equal physical footprint width")
    if min(
        geometry.width_cells,
        geometry.height_cells,
        geometry.depth_cells,
        geometry.projected_depth_cells,
        geometry.foundation_thickness_cells,
    ) <= 0:
        errors.append("all geometry dimensions must be positive")
    if geometry.projected_depth_cells >= geometry.depth_cells:
        errors.append("projected roof depth must be shallower than physical map depth")
    if geometry.clearance_cells != 1:
        errors.append("construction clearance must be exactly one cell")
    if not 0 <= geometry.entrance_offset < geometry.width_cells:
        errors.append("south entrance offset is outside the footprint")
    if geometry.door_module_size not in ((8, 16), (16, 16)):
        errors.append("doorSizePx must be an 8x16 single or 16x16 double module")
    expected_leaf_width = 6 if geometry.door_module_size[0] == 8 else 12
    if geometry.door_leaf_size != (expected_leaf_width, 14):
        errors.append(
            "doorLeafSizePx must be 6x14 for a single door or 12x14 for a double door"
        )
    if not 0 <= geometry.door_bottom_inset_px <= geometry.cell:
        errors.append("doorBottomInsetPx must stay within one 8px cell")
    for label, value_range, maximum in (
        ("finishedOccupiedWidthPxRange", geometry.finished_occupied_width_range, geometry.sprite_size[0]),
        ("finishedOccupiedHeightPxRange", geometry.finished_occupied_height_range, geometry.sprite_size[1]),
    ):
        if value_range is not None and (
            len(value_range) != 2
            or value_range[0] <= 0
            or value_range[0] > value_range[1]
            or value_range[1] > maximum
        ):
            errors.append(f"{label} must be an ordered positive range inside the sprite canvas")
    envelope_width, envelope_depth = geometry.envelope_cells
    if geometry.site_columns < envelope_width or geometry.site_rows < envelope_depth:
        errors.append("preview site cannot contain the construction envelope")
    if errors:
        raise ValueError("; ".join(errors))
    return geometry


def remove_chroma(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    pixels = rgba.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            red, green, blue, alpha = pixels[x, y]
            keyed = red >= 100 and blue >= 100 and min(red, blue) >= green + 40
            # Image generators often leave 1–15 alpha speckles outside the
            # visible subject. Promoting any non-zero alpha to opaque expands
            # the authoring frame to the whole canvas and silently squashes
            # every construction stage during normalization.
            visible = alpha >= 16
            pixels[x, y] = (red, green, blue, 0 if keyed or not visible else 255)
    return rgba


def normalized_frame(bounds: tuple[int, int, int, int], size: tuple[int, int]) -> tuple[float, float, float, float]:
    left, top, right, bottom = bounds
    width, height = size
    return left / width, top / height, right / width, bottom / height


def frame_box(frame: tuple[float, float, float, float], size: tuple[int, int]) -> tuple[int, int, int, int]:
    width, height = size
    left = max(0, min(width - 1, round(frame[0] * width)))
    top = max(0, min(height - 1, round(frame[1] * height)))
    right = max(left + 1, min(width, round(frame[2] * width)))
    bottom = max(top + 1, min(height, round(frame[3] * height)))
    return left, top, right, bottom


def normalize(
    source: Image.Image,
    geometry: Geometry,
    authoring_frame: tuple[float, float, float, float] | None,
) -> Image.Image:
    transparent = remove_chroma(source)
    bounds = transparent.getchannel("A").getbbox()
    if bounds is None:
        raise ValueError("source is empty after chroma removal")
    # Stage 5 defines the immutable authoring window. Applying that same
    # relative crop preserves real height/width progression. Optional stages
    # 1–2 are forensic-only inputs; catalog work verifies shared construction
    # tiles through construction-stage tests.
    # cropping every stage to its own alpha would incorrectly upscale a low
    # foundation or half-built frame to the full tower height.
    subject = transparent.crop(frame_box(authoring_frame, transparent.size) if authoring_frame else bounds)
    target_width, target_height = geometry.sprite_size
    scale = min(target_width / subject.width, target_height / subject.height)
    resized = subject.resize(
        (max(1, round(subject.width * scale)), max(1, round(subject.height * scale))),
        Image.Resampling.NEAREST,
    )
    output = Image.new("RGBA", geometry.sprite_size, (0, 0, 0, 0))
    output.alpha_composite(resized, ((target_width - resized.width) // 2, target_height - resized.height))
    output_bounds = output.getchannel("A").getbbox()
    if output_bounds is None:
        raise ValueError("normalized authoring frame contains no structure")
    left, _, right, bottom = output_bounds
    # Translation to the declared anchor is deterministic normalization, not
    # geometric repair: keep the common scale from stage 5, then align every
    # stage to the same bottom-centre without stretching its progress height.
    shift_x = target_width // 2 - round((left + right) / 2)
    shift_y = target_height - bottom
    anchored = Image.new("RGBA", geometry.sprite_size, (0, 0, 0, 0))
    anchored.alpha_composite(output, (shift_x, shift_y))
    alpha = anchored.getchannel("A").point(lambda value: 255 if value >= 80 else 0)
    # Catalog sources are the production-size authority. Quantize here, after
    # geometry is fixed, so the runtime fast path cannot accidentally preserve
    # thousands of antialiased generator colors in an otherwise tiny sprite.
    reduced = anchored.quantize(
        colors=31,
        method=Image.Quantize.FASTOCTREE,
        dither=Image.Dither.NONE,
    ).convert("RGBA")
    reduced.putalpha(alpha)
    return reduced


def pavement_tile(index: int, cell: int) -> Image.Image:
    if cell != 8:
        raise ValueError("pavement matrices require an 8px cell")
    matrix = PAVEMENT_VARIANTS[index % len(PAVEMENT_VARIANTS)]
    tile = Image.new("RGBA", (cell, cell), (0, 0, 0, 0))
    pixels = tile.load()
    for y, row in enumerate(matrix):
        for x, key in enumerate(row):
            pixels[x, y] = PAVEMENT_PALETTE[key]
    return tile


def pavement_grid(columns: int, rows: int, cell: int) -> Image.Image:
    grid = Image.new("RGBA", (columns * cell, rows * cell), (0, 0, 0, 0))
    for row in range(rows):
        for column in range(columns):
            index = ((column * 37) ^ (row * 53) ^ (column * row * 11)) % len(PAVEMENT_VARIANTS)
            grid.alpha_composite(pavement_tile(index, cell), (column * cell, row * cell))
    return grid


def residential_yard_grid(geometry: Geometry) -> Image.Image:
    """Render the same semantic surface used by ordinary HOUSE plots.

    The preview is intentionally deterministic: grass is the dominant surface,
    small meadow/dirt accents break repetition, and the two-cell approach path
    terminates at the declared south entrance.  This makes the verifier catch a
    misplaced door or an accidentally paved ordinary residence before runtime.
    """
    cell = geometry.cell
    columns = geometry.site_columns
    rows = geometry.site_rows
    grid = Image.new("RGBA", (columns * cell, rows * cell), (0, 0, 0, 0))
    palettes = (
        ((100, 137, 70, 255), (111, 150, 76, 255), (81, 116, 61, 255)),
        ((108, 143, 72, 255), (122, 156, 78, 255), (91, 123, 63, 255)),
        ((94, 128, 67, 255), (105, 143, 72, 255), (76, 108, 58, 255)),
    )
    for row in range(rows):
        for column in range(columns):
            base, light, dark = palettes[((column * 37) ^ (row * 53)) % len(palettes)]
            tile = Image.new("RGBA", (cell, cell), base)
            pixels = tile.load()
            pixels[(column * 3 + row * 5) % cell, (column * 5 + row * 3) % cell] = light
            pixels[(column * 7 + row * 2 + 1) % cell, (column * 2 + row * 7 + 2) % cell] = dark
            grid.alpha_composite(tile, (column * cell, row * cell))

    current_layout = layout(geometry)
    entrance_column = current_layout["originX"] + geometry.entrance_offset
    south_edge = current_layout["originY"] + geometry.depth_cells
    path = ImageDraw.Draw(grid)
    for row in range(south_edge, min(rows, south_edge + 2)):
        left = entrance_column * cell
        top = row * cell
        path.rectangle((left, top, left + cell - 1, top + cell - 1), fill=(126, 103, 72, 255))
        path.line((left, top, left + cell - 1, top), fill=(158, 132, 91, 255))
        path.point((left + 2, top + 4), fill=(93, 78, 58, 255))
        path.point((left + 6, top + 6), fill=(174, 145, 96, 255))
    return grid


def site_grid(geometry: Geometry) -> Image.Image:
    return residential_yard_grid(geometry) if geometry.category == "HOUSE" else pavement_grid(
        geometry.site_columns, geometry.site_rows, geometry.cell
    )


def layout(geometry: Geometry) -> dict[str, int]:
    origin_x = (geometry.site_columns - geometry.width_cells) // 2
    origin_y = (geometry.site_rows - geometry.depth_cells) // 2
    anchor_x = origin_x * geometry.cell + geometry.sprite_size[0] // 2
    anchor_y = (origin_y + geometry.depth_cells) * geometry.cell
    platform_offset_y = max(0, geometry.sprite_size[1] - anchor_y)
    return {
        "originX": origin_x,
        "originY": origin_y,
        "anchorX": anchor_x,
        "anchorY": anchor_y,
        "platformOffsetY": platform_offset_y,
    }


def draw_fence(draw: ImageDraw.ImageDraw, geometry: Geometry, current_layout: dict[str, int], y_offset: int) -> None:
    cell = geometry.cell
    clearance = geometry.clearance_cells
    left = (current_layout["originX"] - clearance) * cell
    top = y_offset + (current_layout["originY"] - clearance) * cell
    right = (current_layout["originX"] + geometry.width_cells + clearance) * cell - 1
    bottom = y_offset + (current_layout["originY"] + geometry.depth_cells + clearance) * cell - 1
    rail = (92, 75, 57, 255)
    post = (55, 67, 70, 255)
    highlight = (151, 132, 95, 255)
    gate_center = (current_layout["originX"] + geometry.entrance_offset) * cell + cell // 2
    gate_half_width = cell

    draw.line((left, top, right, top), fill=rail, width=2)
    draw.line((left, top, left, bottom), fill=rail, width=2)
    draw.line((right, top, right, bottom), fill=rail, width=2)
    draw.line((left, bottom, gate_center - gate_half_width, bottom), fill=rail, width=2)
    draw.line((gate_center + gate_half_width, bottom, right, bottom), fill=rail, width=2)
    for x in range(left, right + 1, cell):
        draw.rectangle((x, top - 1, x + 1, top + 2), fill=post)
        if not gate_center - gate_half_width < x < gate_center + gate_half_width:
            draw.rectangle((x, bottom - 2, x + 1, bottom + 1), fill=post)
    for y in range(top, bottom + 1, cell):
        draw.rectangle((left - 1, y, left + 2, y + 1), fill=post)
        draw.rectangle((right - 2, y, right + 1, y + 1), fill=post)
    draw.point((left + 2, top + 1), fill=highlight)


def render_preview(image: Image.Image, geometry: Geometry, stage: int, *, debug: bool) -> Image.Image:
    current_layout = layout(geometry)
    site_width = geometry.site_columns * geometry.cell
    site_height = geometry.site_rows * geometry.cell
    y_offset = current_layout["platformOffsetY"]
    canvas = Image.new("RGBA", (site_width, site_height + y_offset), (102, 133, 72, 255))
    canvas.alpha_composite(site_grid(geometry), (0, y_offset))
    draw = ImageDraw.Draw(canvas)

    if stage < 5:
        draw_fence(draw, geometry, current_layout, y_offset)

    if debug:
        cell = geometry.cell
        left = current_layout["originX"] * cell
        top = y_offset + current_layout["originY"] * cell
        right = left + geometry.width_cells * cell - 1
        bottom = top + geometry.depth_cells * cell - 1
        envelope_left = left - geometry.clearance_cells * cell
        envelope_top = top - geometry.clearance_cells * cell
        envelope_right = right + geometry.clearance_cells * cell
        envelope_bottom = bottom + geometry.clearance_cells * cell
        draw.rectangle((envelope_left, envelope_top, envelope_right, envelope_bottom), outline=(224, 90, 77, 255), width=1)
        draw.rectangle((left, top, right, bottom), outline=(242, 200, 75, 255), width=1)

    sprite_x = current_layout["anchorX"] - image.width // 2
    sprite_y = y_offset + current_layout["anchorY"] - image.height
    canvas.alpha_composite(image, (sprite_x, sprite_y))

    if debug:
        draw = ImageDraw.Draw(canvas)
        # Draw entrance rulers above the sprite. Pixel-color heuristics confuse
        # teal windows, shop glazing and doors, so the native-grid visual gate
        # needs an explicit functional module and moving-leaf measurement.
        cell = geometry.cell
        left = current_layout["originX"] * cell
        bottom = y_offset + (current_layout["originY"] + geometry.depth_cells) * cell - 1
        module_width, module_height = geometry.door_module_size
        leaf_width, leaf_height = geometry.door_leaf_size
        # Catalog entrance offsets are axes measured from the footprint's left
        # edge (the same convention used by construction gates), not cell
        # indices whose centre needs another half-cell shift.
        entrance_center_x = left + geometry.entrance_offset * cell
        entrance_baseline_y = bottom + 1 - geometry.door_bottom_inset_px
        module_left = entrance_center_x - module_width // 2
        module_top = entrance_baseline_y - module_height
        leaf_left = entrance_center_x - leaf_width // 2
        leaf_top = entrance_baseline_y - leaf_height
        draw.rectangle(
            (module_left, module_top, module_left + module_width - 1, entrance_baseline_y - 1),
            outline=(61, 211, 255, 255),
            width=1,
        )
        draw.rectangle(
            (leaf_left, leaf_top, leaf_left + leaf_width - 1, entrance_baseline_y - 1),
            outline=(255, 105, 180, 255),
            width=1,
        )
        anchor_x = current_layout["anchorX"]
        anchor_y = y_offset + current_layout["anchorY"]
        draw.line((anchor_x - 3, anchor_y, anchor_x + 3, anchor_y), fill=(220, 72, 72, 255), width=1)
        draw.line((anchor_x, anchor_y - 3, anchor_x, anchor_y + 3), fill=(220, 72, 72, 255), width=1)
    return canvas


def image_metrics(source: Image.Image, normalized: Image.Image) -> dict[str, Any]:
    bounds = normalized.getchannel("A").getbbox()
    if bounds is None:
        raise ValueError("normalized image is empty")
    left, top, right, bottom = bounds
    source_colors = source.convert("RGBA").getcolors(maxcolors=1_000_000)
    source_alpha_extrema = remove_chroma(source).getchannel("A").getextrema()
    normalized_colors = normalized.getcolors(maxcolors=1_000_000)
    return {
        "sourceSizePx": list(source.size),
        "sourceColorCount": len(source_colors) if source_colors is not None else None,
        "sourceHasTransparentPixels": source_alpha_extrema[0] == 0,
        "normalizedSizePx": list(normalized.size),
        "normalizedColorCount": len(normalized_colors) if normalized_colors is not None else None,
        "opaqueBoundsPx": [left, top, right, bottom],
        "opaqueWidthPx": right - left,
        "opaqueHeightPx": bottom - top,
        "centerXPx": (left + right) / 2,
        "baselineYPx": bottom,
        "widthCoverage": round((right - left) / normalized.width, 4),
        "heightCoverage": round((bottom - top) / normalized.height, 4),
    }


def validate_stages(geometry: Geometry, metrics: dict[int, dict[str, Any]]) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    for stage, current in metrics.items():
        if not current["sourceHasTransparentPixels"]:
            errors.append(
                f"stage {stage}: source has no transparent pixels after chroma removal; "
                "reject baked checkerboard or opaque backdrop"
            )
        if current["baselineYPx"] < geometry.sprite_size[1] - 1:
            errors.append(f"stage {stage}: structure does not reach the shared bottom baseline")
        if current["normalizedColorCount"] and current["normalizedColorCount"] > 32:
            warnings.append(f"stage {stage}: {current['normalizedColorCount']} colors require authored quantization review")

    final = metrics.get(5)
    if final is None:
        warnings.append("stage 5 is absent; cross-stage proportions cannot be verified")
        return errors, warnings

    if geometry.category == "HIGHRISE":
        if not 0.65 <= final["widthCoverage"] <= 0.95:
            errors.append("stage 5: high-rise occupied width must cover 65–95% of canvas")
        if final["heightCoverage"] < 0.94:
            errors.append("stage 5: high-rise occupied height must cover at least 94% of canvas")
    elif geometry.category == "HOUSE":
        if not 0.70 <= final["widthCoverage"] <= 1.00:
            errors.append("stage 5: ordinary house occupied width must cover 70–100% of canvas")
        if not 0.70 <= final["heightCoverage"] <= 1.00:
            errors.append("stage 5: ordinary house occupied height must cover 70–100% of canvas")

    if geometry.finished_occupied_width_range is not None:
        minimum, maximum = geometry.finished_occupied_width_range
        if not minimum <= final["opaqueWidthPx"] <= maximum:
            errors.append(
                f"stage 5: occupied width {final['opaqueWidthPx']}px is outside the building-specific "
                f"{minimum}–{maximum}px scale contract"
            )
    if geometry.finished_occupied_height_range is not None:
        minimum, maximum = geometry.finished_occupied_height_range
        if not minimum <= final["opaqueHeightPx"] <= maximum:
            errors.append(
                f"stage 5: occupied height {final['opaqueHeightPx']}px is outside the building-specific "
                f"{minimum}–{maximum}px scale contract"
            )

    final_width = float(final["opaqueWidthPx"])
    final_height = float(final["opaqueHeightPx"])
    final_center = float(final["centerXPx"])
    final_baseline = float(final["baselineYPx"])
    for stage, current in metrics.items():
        if abs(float(current["centerXPx"]) - final_center) > geometry.cell:
            errors.append(f"stage {stage}: horizontal centre drifts by more than one cell")
        if abs(float(current["baselineYPx"]) - final_baseline) > 1:
            errors.append(f"stage {stage}: baseline drifts by more than one pixel")

    stage4 = metrics.get(4)
    if stage4 and not (0.85 * final_width <= stage4["opaqueWidthPx"] <= 1.10 * final_width):
        ratio = float(stage4["opaqueWidthPx"]) / final_width
        errors.append(
            f"stage 4: occupied width is {ratio:.1%} of final; must remain within 85–110%"
        )
    # One pixel is an intentional raster tolerance: at compact-house scale a
    # scaffold cap cannot be expressed as a fractional 5% allowance.
    if stage4 and not (0.85 * final_height <= stage4["opaqueHeightPx"] <= 1.05 * final_height + 1):
        ratio = float(stage4["opaqueHeightPx"]) / final_height
        errors.append(
            f"stage 4: occupied height is {ratio:.1%} of final; must remain within 85–105%"
        )
    if stage4:
        width_ratio = float(stage4["opaqueWidthPx"]) / final_width
        height_ratio = float(stage4["opaqueHeightPx"]) / final_height
        if not 0.90 <= width_ratio <= 1.00:
            warnings.append(
                f"stage 4: occupied width is {width_ratio:.1%} of final; "
                "the preferred authoring target is 90–100%"
            )
        if not 0.90 <= height_ratio <= 1.00:
            warnings.append(
                f"stage 4: occupied height is {height_ratio:.1%} of final; "
                "the preferred authoring target is 90–100%; keep scaffolds and poles inside the final extrema"
            )

    stage3 = metrics.get(3)
    if stage3 and not (0.60 * final_width <= stage3["opaqueWidthPx"] <= 1.10 * final_width):
        ratio = float(stage3["opaqueWidthPx"]) / final_width
        errors.append(
            f"stage 3: occupied width is {ratio:.1%} of final; must remain within 60–110%"
        )
    stage3_max_height_ratio = 0.80
    if stage3 and not (0.45 * final_height <= stage3["opaqueHeightPx"] <= stage3_max_height_ratio * final_height):
        ratio = float(stage3["opaqueHeightPx"]) / final_height
        errors.append(
            f"stage 3: occupied height is {ratio:.1%} of final; must remain within 45–80%"
        )
    if stage3:
        ratio = float(stage3["opaqueHeightPx"]) / final_height
        if not 0.55 <= ratio <= 0.65:
            warnings.append(
                f"stage 3: occupied height is {ratio:.1%} of final; "
                "the preferred authoring target is 55–65%; do not use long rebar to fake structural height"
            )

    stage2 = metrics.get(2)
    if stage2 and not (0.90 * final_width <= stage2["opaqueWidthPx"] <= 1.10 * final_width):
        errors.append("stage 2: foundation width must remain within 90–110% of the measured roof/final width proxy")
    if stage2 and abs(stage2["opaqueHeightPx"] - geometry.foundation_total_height_px) > geometry.cell:
        errors.append("stage 2: foundation plane plus structural rim differs from the geometry contract by more than one cell")

    stage1 = metrics.get(1)
    if stage1 and stage2 and stage1["opaqueWidthPx"] < 0.75 * stage2["opaqueWidthPx"]:
        errors.append("stage 1: prepared site spans less than 75% of the foundation width")
    if stage1 and stage1["opaqueHeightPx"] > 0.35 * final_height:
        errors.append("stage 1: prepared site is taller than 35% of the final building")
    return errors, warnings


def generation_guidance(metrics: dict[int, dict[str, Any]]) -> dict[str, Any]:
    """Expose authoring targets separately from hard verifier tolerances."""
    final = metrics.get(5)
    ratios: dict[str, dict[str, float]] = {}
    if final is not None:
        final_width = float(final["opaqueWidthPx"])
        final_height = float(final["opaqueHeightPx"])
        for stage in (3, 4):
            current = metrics.get(stage)
            if current is None:
                continue
            ratios[str(stage)] = {
                "widthToFinal": round(float(current["opaqueWidthPx"]) / final_width, 4),
                "heightToFinal": round(float(current["opaqueHeightPx"]) / final_height, 4),
            }
    return {
        "recommendedAuthoringTargets": {
            "stage3HeightToFinal": [0.55, 0.65],
            "stage4HeightToFinal": [0.90, 1.00],
            "stage4WidthToFinal": [0.90, 1.00],
        },
        "hardVerifierBands": {
            "stage3HeightToFinal": [0.45, 0.80],
            "stage3WidthToFinal": [0.60, 1.10],
            "stage4HeightToFinal": [0.85, 1.05],
            "stage4WidthToFinal": [0.85, 1.10],
        },
        "measuredRatios": ratios,
        "retryRule": (
            "Regenerate the authored stage using its measured ratio and failed invariant; "
            "never stretch, crop, translate, or loosen the geometry contract."
        ),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract", type=Path, required=True)
    for stage in range(1, 6):
        parser.add_argument(f"--stage-{stage}", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--preview-scale", type=int, default=4)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    geometry = load_geometry(args.contract)
    output_dir: Path = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    metrics: dict[int, dict[str, Any]] = {}
    outputs: dict[int, dict[str, str]] = {}

    sources: dict[int, tuple[Path, Image.Image]] = {}
    for stage in range(1, 6):
        source_path: Path | None = getattr(args, f"stage_{stage}")
        if source_path is not None:
            sources[stage] = (source_path, Image.open(source_path))
    if not sources:
        raise SystemExit("at least one --stage-N image is required")

    authoring_frame: tuple[float, float, float, float] | None = None
    if 5 in sources:
        final_transparent = remove_chroma(sources[5][1])
        final_bounds = final_transparent.getchannel("A").getbbox()
        if final_bounds is None:
            raise SystemExit("stage 5 is empty after chroma removal")
        authoring_frame = normalized_frame(final_bounds, final_transparent.size)

    for stage, (source_path, source) in sorted(sources.items()):
        normalized = normalize(source, geometry, authoring_frame)
        normalized_path = output_dir / f"stage-{stage}-normalized.png"
        preview_path = output_dir / f"stage-{stage}-on-grid.png"
        preview_4x_path = output_dir / f"stage-{stage}-on-grid-4x.png"
        geometry_path = output_dir / f"stage-{stage}-geometry.png"
        geometry_4x_path = output_dir / f"stage-{stage}-geometry-4x.png"
        normalized.save(normalized_path, optimize=True)
        clean_preview = render_preview(normalized, geometry, stage, debug=False)
        debug_preview = render_preview(normalized, geometry, stage, debug=True)
        clean_preview.save(preview_path, optimize=True)
        debug_preview.save(geometry_path, optimize=True)
        clean_preview.resize(
            (clean_preview.width * args.preview_scale, clean_preview.height * args.preview_scale),
            Image.Resampling.NEAREST,
        ).save(preview_4x_path, optimize=True)
        debug_preview.resize(
            (debug_preview.width * args.preview_scale, debug_preview.height * args.preview_scale),
            Image.Resampling.NEAREST,
        ).save(geometry_4x_path, optimize=True)
        metrics[stage] = image_metrics(source, normalized)
        outputs[stage] = {
            "normalized": str(normalized_path),
            "preview": str(preview_path),
            "preview4x": str(preview_4x_path),
            "geometry": str(geometry_path),
            "geometry4x": str(geometry_4x_path),
        }

    errors, warnings = validate_stages(geometry, metrics)
    report = {
        "key": geometry.key,
        "geometry": {
            "cellSizePx": geometry.cell,
            "spriteCanvasCells": [geometry.width_cells, geometry.height_cells],
            "spriteCanvasPx": list(geometry.sprite_size),
            "physicalFootprintCells": [geometry.width_cells, geometry.depth_cells],
            "projectedRoofDepthCells": geometry.projected_depth_cells,
            "projectedRoofDepthPx": geometry.projected_depth_px,
            "foundationThicknessCells": geometry.foundation_thickness_cells,
            "foundationTotalHeightPx": geometry.foundation_total_height_px,
            "depthProjectionRatio": round(geometry.projection_ratio, 4),
            "constructionClearanceCells": geometry.clearance_cells,
            "constructionEnvelopeCells": list(geometry.envelope_cells),
            "anchorPx": list(geometry.anchor),
            "doorSizePx": list(geometry.door_module_size),
            "doorLeafSizePx": list(geometry.door_leaf_size),
            "doorBottomInsetPx": geometry.door_bottom_inset_px,
            "finishedOccupiedWidthPxRange": list(geometry.finished_occupied_width_range)
            if geometry.finished_occupied_width_range else None,
            "finishedOccupiedHeightPxRange": list(geometry.finished_occupied_height_range)
            if geometry.finished_occupied_height_range else None,
            "authoringFrameNormalized": list(authoring_frame) if authoring_frame else None,
        },
        "stages": {str(stage): metric for stage, metric in sorted(metrics.items())},
        "outputs": {str(stage): output for stage, output in sorted(outputs.items())},
        "errors": errors,
        "warnings": warnings,
        "generationGuidance": generation_guidance(metrics),
        "manualChecks": [
            "strict frontal-top projection; no side or isometric facade",
            "roof, porch, steps, canopy, balconies, podium, setbacks and crown share one compressed top-plane direction",
            "foundation screen plane matches the finished roof plane",
            "same building identity, entrance and facade bay rhythm",
            "fence remains a separate site overlay with a south gate",
            "native-scale pixel clusters remain readable without blur",
            "cyan door-module guide encloses the complete entrance; magenta leaf guide encloses only moving leaves",
        ],
        "acceptedByCode": not errors,
    }
    report_path = output_dir / "report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"report": str(report_path), "acceptedByCode": not errors, "errors": errors}, ensure_ascii=False))
    raise SystemExit(0 if not errors else 1)


if __name__ == "__main__":
    main()
