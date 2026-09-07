#!/usr/bin/env python3
"""Normalize and audit the compact-city authored building family without repainting."""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from collections import deque
from pathlib import Path

from PIL import Image, ImageDraw


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def pixel_data(image: Image.Image):
    return image.get_flattened_data() if hasattr(image, "get_flattened_data") else image.getdata()


def visible_bounds(image: Image.Image):
    return image.getchannel("A").point(lambda value: 255 if value >= 16 else 0).getbbox()


def common_source_frame(authority: Image.Image, contract: dict) -> tuple[int, int, int, int]:
    """One finished-stage frame; optional margins may add background, never crop.

    Omitting the field retains the exact historical tight-frame transform.
    The declared frame is validated once and then reused by every stage.
    """
    bounds = visible_bounds(authority)
    if not bounds:
        raise SystemExit("Stage 5 is empty")
    if "commonSourceFrame" not in contract:
        return bounds
    frame = contract["commonSourceFrame"]
    if (not isinstance(frame, list) or len(frame) != 4
            or any(type(value) is not int or abs(value) > 9007199254740991 for value in frame)):
        raise SystemExit("commonSourceFrame must contain four safe integer coordinates")
    left, top, right, bottom = frame
    width, height = authority.size
    if not (0 <= left < right <= width and 0 <= top < bottom <= height):
        raise SystemExit("commonSourceFrame must be non-empty and inside the source canvas")
    x0, y0, x1, y1 = bounds
    if left > x0 or top > y0 or right < x1 or bottom < y1:
        raise SystemExit("commonSourceFrame must fully contain stage-5 visible bounds; opaque cropping is forbidden")
    # Integer arithmetic keeps the per-side 2% limit exact at the boundary.
    if ((x0 - left) * 50 > x1 - x0 or (right - x1) * 50 > x1 - x0
            or (y0 - top) * 50 > y1 - y0 or (bottom - y1) * 50 > y1 - y0):
        raise SystemExit("commonSourceFrame: each outward margin must be at most 2% of the visible width/height")
    return tuple(frame)


def extract_source(path: Path, background: str | None) -> Image.Image:
    image = Image.open(path).convert("RGBA")
    if background == "magenta-recovery":
        image.putdata([(0, 0, 0, 0) if red > 180 and blue > 180 and green < 100 else (red, green, blue, alpha) for red, green, blue, alpha in pixel_data(image)])
    elif background == "magenta-chroma-family":
        # Key the chroma family, including dark compression/noise variants of
        # the magenta backdrop. An absolute >180 cutoff left isolated purple
        # background pixels and incorrectly enlarged the source geometry.
        # Explicit authoring contract: magenta is reserved for this broader
        # recovery key and cannot be used as a building material color.
        image.putdata([(0, 0, 0, 0) if min(red, blue) > 90
                       and max(red, blue) <= min(red, blue) * 1.35
                       and green < min(red, blue) * .6
                       else (red, green, blue, alpha) for red, green, blue, alpha in pixel_data(image)])
    return image


def transparent_holes(image: Image.Image) -> int:
    """Count transparent pixels enclosed inside the roof/room/facade silhouette."""
    width, height = image.size
    alpha = image.getchannel("A")
    exterior = set()
    queue = deque()
    for y in range(height):
        for x in range(width):
            if (x in (0, width - 1) or y in (0, height - 1)) and alpha.getpixel((x, y)) == 0:
                queue.append((x, y))
                exterior.add((x, y))
    while queue:
        x, y = queue.popleft()
        for point in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            nx, ny = point
            if 0 <= nx < width and 0 <= ny < height and point not in exterior and alpha.getpixel(point) == 0:
                exterior.add(point)
                queue.append(point)
    return sum(alpha.getpixel((x, y)) == 0 and (x, y) not in exterior for y in range(height) for x in range(width))


def main() -> int:
    # Park authoring loads only the standalone raster helpers via runpy; the
    # building CLI owns projection-record validation and its sibling module.
    from compact_asset_contract import audit_compact_projection
    from reviewed_png import save_reviewed_png

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--family", type=Path, help="One authoring family; omitted audits every registered family.")
    parser.add_argument("--require-complete", action="store_true")
    parser.add_argument("--require-review", action="store_true")
    args = parser.parse_args()
    if args.family is None:
        root = Path(__file__).resolve().parents[1]
        pack = root / "assets/pixel-city-pack"
        catalog = json.loads((pack / "catalog" / "buildings.json").read_text())
        statuses = []
        for entry in catalog["buildings"]:
            command = [sys.executable, __file__, "--family", str(pack / "reference" / "ai-authored" / entry["key"])]
            if args.require_complete:
                command.append("--require-complete")
            if args.require_review:
                command.append("--require-review")
            statuses.append(subprocess.run(command, check=False).returncode)
        return 1 if not statuses or any(statuses) else 0
    family = args.family
    contract = json.loads((family / "geometry.json").read_text())
    review_path = family / "visual-review.json"
    review = json.loads(review_path.read_text()) if review_path.exists() else {}
    palette_method = contract.get("paletteMethod", "MEDIANCUT")
    if palette_method not in ("MEDIANCUT", "MAXCOVERAGE"):
        raise SystemExit("Unsupported paletteMethod; use MEDIANCUT or MAXCOVERAGE")
    output = family / "normalized"
    previews = family / "previews"
    output.mkdir(parents=True, exist_ok=True)
    previews.mkdir(parents=True, exist_ok=True)
    sources = {stage: family / "sources" / f"stage-{stage}.png" for stage in (5, 4, 3)}
    sources = {stage: path for stage, path in sources.items() if path.exists()}
    errors = []
    if args.require_complete and set(sources) != {3, 4, 5}:
        errors.append("A publishable family requires all three authored stages")
    if 5 not in sources:
        raise SystemExit("stage-5.png is required before reverse-stage normalization")
    images = {stage: extract_source(path, contract.get("sourceBackground")) for stage, path in sources.items()}
    authority = images[5]
    frame = common_source_frame(authority, contract)
    width, height = contract["spriteSize"]
    scale = min(width / (frame[2] - frame[0]), height / (frame[3] - frame[1]))
    target_size = (round((frame[2] - frame[0]) * scale), round((frame[3] - frame[1]) * scale))
    offset = ((width - target_size[0]) // 2, height - target_size[1])
    report = {
        "key": contract["key"], "contract": "geometry.json", "normalization": contract["normalization"],
        "sourceCanvas": list(authority.size), "sourceBackground": contract.get("sourceBackground", "transparent"), "commonSourceFrame": list(frame), "uniformScale": scale,
        "targetSize": list(target_size), "offset": list(offset), "paletteMethod": palette_method, "stages": {}, "errors": errors,
        "semanticChecksRequireVisualReview": ["roof-dominant axis-aligned high camera", "same entrance and contracted floor rhythm", "no receding side wall", "stage-4 roof coverage approximately 50% and no final roof equipment", "stage-3 open rooms with opaque floor and interior walls", "no external fence, scenery or black baseline", "same building identity in all stages"],
    }
    normalized = {}
    for stage, source in images.items():
        if source.size != authority.size:
            errors.append(f"Stage {stage}: source canvas differs from stage 5")
            continue
        if source.getchannel("A").getextrema()[0] == 255:
            errors.append(f"Stage {stage}: opaque source background, true alpha required")
            continue
        stage_bounds = visible_bounds(source)
        if not stage_bounds:
            errors.append(f"Stage {stage}: empty source")
            continue
        # The contract's one-pixel registration tolerance is measured on the
        # runtime grid, not the much larger authored source canvas.
        source_tolerance = contract["stageBaselineDriftPxMax"] / scale
        if any((stage_bounds[0] < frame[0] - source_tolerance, stage_bounds[1] < frame[1] - source_tolerance, stage_bounds[2] > frame[2] + source_tolerance, stage_bounds[3] > frame[3] + source_tolerance)):
            errors.append(f"Stage {stage}: geometry extends beyond the immutable finished source frame")
        image = source.crop(frame).resize(target_size, Image.Resampling.NEAREST)
        alpha = image.getchannel("A").point(lambda value: 255 if value >= 128 else 0)
        image = image.convert("RGB").quantize(colors=31, method=getattr(Image.Quantize, palette_method), dither=Image.Dither.NONE).convert("RGBA")
        image.putalpha(alpha)
        canvas = Image.new("RGBA", (width, height))
        canvas.paste(image, offset)
        # Canonicalize invisible RGB to zero; this does not touch visible geometry.
        canvas.putdata([pixel if pixel[3] else (0, 0, 0, 0) for pixel in pixel_data(canvas)])
        path = output / f"stage-{stage}.png"
        approved = review.get("stages", {}).get(str(stage), {})
        try:
            runtime_sha = save_reviewed_png(canvas, path, sha256(sources[stage]),
                                           approved if approved.get("accepted") is True else None)
        except ValueError as error:
            errors.append(f"Stage {stage}: {error}")
            continue
        bounds = visible_bounds(canvas)
        colors = len(set(pixel_data(canvas)))
        if colors > contract["paletteColorsMax"]:
            errors.append(f"Stage {stage}: {colors} colors exceed palette budget")
        if bounds[3] != height:
            errors.append(f"Stage {stage}: ground line does not meet bottom-centre anchor")
        hole_pixels = transparent_holes(canvas)
        if hole_pixels:
            errors.append(f"Stage {stage}: {hole_pixels} transparent pixels inside roof/rooms/facade")
        measured = {"sourceSha256": sha256(sources[stage]), "runtimeSha256": runtime_sha, "sourceBounds": list(stage_bounds), "occupiedBoundsPx": list(bounds), "occupiedSizePx": [bounds[2] - bounds[0], bounds[3] - bounds[1]], "paletteColors": colors, "alphaValues": sorted(set(pixel_data(canvas.getchannel("A")))), "transparentHolePixels": hole_pixels}
        report["stages"][str(stage)] = measured
        normalized[stage] = canvas
        preview_width, preview_height = max(64, width + 16), max(64, height + 16)
        preview = Image.new("RGBA", (preview_width, preview_height), (126, 147, 88, 255))
        draw = ImageDraw.Draw(preview)
        for position in range(0, preview_width, 8):
            draw.line((position, 0, position, preview_height - 1), fill=(111, 130, 80, 255))
        for position in range(0, preview_height, 8):
            draw.line((0, position, preview_width - 1, position), fill=(111, 130, 80, 255))
        preview.alpha_composite(canvas, (8, 8))
        preview.save(previews / f"stage-{stage}-grid.png")
        preview.resize((preview_width * 8, preview_height * 8), Image.Resampling.NEAREST).save(previews / f"stage-{stage}-grid-8x.png")
    if "5" in report["stages"]:
        final = report["stages"]["5"]
        final_bounds = final["occupiedBoundsPx"]
        for dimension, target in zip(final["occupiedSizePx"], (contract["finishedOccupiedWidthPxRange"], contract["finishedOccupiedHeightPxRange"])):
            if not target[0] <= dimension <= target[1]:
                errors.append(f"Finished occupied size {final['occupiedSizePx']} misses contract")
        for stage, measured in report["stages"].items():
            bounds = measured["occupiedBoundsPx"]
            if stage == "3" and not contract["stage3OccupiedHeightPxRange"][0] <= measured["occupiedSizePx"][1] <= contract["stage3OccupiedHeightPxRange"][1]:
                errors.append("Stage 3: open-floor depth plus half-height facade must remain inside the compact structural height band")
            measured["centreDriftPx"] = abs((bounds[0] + bounds[2] - final_bounds[0] - final_bounds[2]) / 2)
            measured["baselineDriftPx"] = abs(bounds[3] - final_bounds[3])
            if measured["centreDriftPx"] > contract["stageCentreDriftPxMax"] or measured["baselineDriftPx"] > contract["stageBaselineDriftPxMax"]:
                errors.append(f"Stage {stage}: registration drift")
        # Canonical PNGs may use different lossless encodings. Stage identity
        # belongs to the freshly normalized pixels, not compressed file bytes.
        pixels = [(image.size, image.tobytes()) for image in normalized.values()]
        if len(pixels) != len(set(pixels)):
            errors.append("Consecutive construction stages must be visually distinct")
    if len(normalized) == 3:
        authority_alpha = normalized[5].getchannel("A")
        for stage, canvas in normalized.items():
            alpha = canvas.getchannel("A")
            differences = sum(alpha.getpixel((x, y)) != authority_alpha.getpixel((x, y)) for y in contract["foundationMaskRowsPx"] for x in range(width))
            report["stages"][str(stage)]["foundationMaskDifferencePixels"] = differences
            mask_drift = 0
            for y in contract["foundationMaskRowsPx"]:
                expected = [x for x in range(width) if authority_alpha.getpixel((x, y))]
                actual = [x for x in range(width) if alpha.getpixel((x, y))]
                if not expected or not actual:
                    mask_drift = width
                    break
                mask_drift = max(mask_drift, *(min(abs(x - other) for other in actual) for x in expected), *(min(abs(x - other) for other in expected) for x in actual))
            report["stages"][str(stage)]["foundationMaskMaxDriftPx"] = mask_drift
            if mask_drift > contract["foundationMaskDriftPxMax"]:
                errors.append(f"Stage {stage}: foundation-mask drift {mask_drift}px exceeds the registration tolerance")
        comparison_size = (4 + 3 * (width + 4), max(56, height + 8))
        comparison = Image.new("RGBA", comparison_size, (126, 147, 88, 255))
        for index, stage in enumerate((3, 4, 5)):
            comparison.alpha_composite(normalized[stage], (4 + index * (width + 4), 4))
        comparison.save(previews / "stage-sequence.png")
        comparison.resize(tuple(value * 8 for value in comparison_size), Image.Resampling.NEAREST).save(previews / "stage-sequence-8x.png")
    if review_path.exists():
        report["visualReview"] = review
        for stage, measured in report["stages"].items():
            evidence = review.get("stages", {}).get(stage, {})
            if not evidence.get("accepted") or evidence.get("runtimeSha256") != measured["runtimeSha256"]:
                errors.append(f"Stage {stage}: visual review missing or stale")
            if evidence.get("sourceSha256") != measured["sourceSha256"]:
                errors.append(f"Stage {stage}: source review missing or stale")
        errors.extend(audit_compact_projection(review, contract))
    elif args.require_review:
        errors.append("Semantic visual review is required before publishing")
    (family / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
