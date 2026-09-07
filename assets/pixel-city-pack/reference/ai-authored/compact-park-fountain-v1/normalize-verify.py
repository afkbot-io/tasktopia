#!/usr/bin/env python3
"""Normalize AI park art from one fixed frame; never draw runtime geometry."""
import argparse
import json
from pathlib import Path
import runpy

from PIL import Image


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
shared = runpy.run_path(str(ROOT / "scripts/verify-compact-building-art.py"))
extract_source = shared["extract_source"]
visible_bounds = shared["visible_bounds"]
pixel_data = shared["pixel_data"]
sha256 = shared["sha256"]
transparent_holes = shared["transparent_holes"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--family", type=Path, default=HERE)
    parser.add_argument("--require-complete", action="store_true")
    parser.add_argument("--require-review", action="store_true")
    args = parser.parse_args()
    family = args.family.resolve()
    contract = json.loads((family / "geometry.json").read_text())
    output, previews = family / "normalized", family / "previews"
    output.mkdir(exist_ok=True)
    previews.mkdir(exist_ok=True)
    sources = {s: family / f"sources/stage-{s}.png" for s in (5, 4, 3)}
    sources = {s: p for s, p in sources.items() if p.exists()}
    if 5 not in sources:
        raise SystemExit("Stage5 must exist first")
    images = {s: extract_source(p, contract["sourceBackground"]) for s, p in sources.items()}
    authority = images[5]
    frame = visible_bounds(authority)
    if not frame or authority.getchannel("A").getextrema()[0] == 255:
        raise SystemExit("Empty stage5 or non-transparent exterior; no painted checkerboard")
    width, height = contract["spriteSize"]
    scale = min(width / (frame[2] - frame[0]), height / (frame[3] - frame[1]))
    size = (round((frame[2] - frame[0]) * scale), round((frame[3] - frame[1]) * scale))
    offset = ((width - size[0]) // 2, height - size[1])
    errors = []
    report = {"key": contract["key"], "normalization": contract["normalization"], "sourceCanvas": list(authority.size), "sourceBackground": contract["sourceBackground"], "commonSourceFrame": list(frame), "uniformScale": scale, "targetSize": list(size), "offset": list(offset), "stages": {}, "errors": errors}
    if args.require_complete and set(sources) != {3, 4, 5}:
        errors.append("All three separate authored stages required")
    normalized = {}
    for stage, source in images.items():
        bounds = visible_bounds(source)
        if source.size != authority.size or not bounds or source.getchannel("A").getextrema()[0] == 255:
            errors.append(f"Stage{stage}: source canvas/alpha invalid")
            continue
        if max(frame[0] - bounds[0], frame[1] - bounds[1], bounds[2] - frame[2], bounds[3] - frame[3]) * scale > 1:
            errors.append(f"Stage{stage}: extends beyond immutable5 frame by more than1native pixel")
        image = source.crop(frame).resize(size, Image.Resampling.NEAREST)
        alpha = image.getchannel("A").point(lambda a: 255 if a >= 128 else 0)
        image = image.convert("RGB").quantize(colors=contract["paletteColorsMax"] - 1, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert("RGBA")
        image.putalpha(alpha)
        canvas = Image.new("RGBA", (width, height))
        canvas.paste(image, offset)
        canvas.putdata([p if p[3] else (0, 0, 0, 0) for p in pixel_data(canvas)])
        path = output / f"stage-{stage}.png"
        canvas.save(path)
        normalized[stage] = canvas
        opaque = visible_bounds(canvas)
        if not opaque:
            errors.append(f"Stage{stage}: empty normalized object")
            continue
        holes = transparent_holes(canvas)
        colors = len(set(pixel_data(canvas)))
        if opaque[3] != height or holes or colors > contract["paletteColorsMax"]:
            errors.append(f"Stage{stage}: baseline/opaque interior/palette gate failed")
        report["stages"][str(stage)] = {"sourceSha256": sha256(sources[stage]), "runtimeSha256": sha256(path), "sourceBounds": list(bounds), "occupiedBoundsPx": list(opaque), "occupiedSizePx": [opaque[2] - opaque[0], opaque[3] - opaque[1]], "paletteColors": colors, "alphaValues": sorted(set(pixel_data(canvas.getchannel("A")))), "transparentHolePixels": holes}
        if contract["assetRole"] == "FOUNTAIN":
            water = sum(a and b > r * 1.15 and g > r * 1.12 and b > 90 for r, g, b, a in pixel_data(canvas))
            report["stages"][str(stage)]["tealWaterPixels"] = water
            if stage == 5 and water < 20 or stage in (3, 4) and water > 2:
                errors.append(f"Stage{stage}: water/dry construction color gate failed")
        canvas.resize((128, 128), Image.Resampling.NEAREST).save(previews / f"stage-{stage}-8x.png")
        grid = Image.new("RGBA", (48, 48))
        tile = Image.open(ROOT / "assets/pixel-city-pack/runtime/terrain/meadow-0.png").convert("RGBA")
        for x in range(0, 48, 8):
            for y in range(0, 48, 8):
                grid.alpha_composite(tile, (x, y))
        grid.alpha_composite(canvas, (16, 16))
        grid.save(previews / f"stage-{stage}-grid.png")
        grid.resize((384, 384), Image.Resampling.NEAREST).save(previews / f"stage-{stage}-grid-8x.png")
    final = report["stages"].get("5")
    if final:
        for actual, limits in zip(final["occupiedSizePx"], (contract["finishedOccupiedWidthPxRange"], contract["finishedOccupiedHeightPxRange"])):
            if not limits[0] <= actual <= limits[1]:
                errors.append("Finished occupied size misses declared contract")
        base = final["occupiedBoundsPx"]
        expected_alpha = normalized[5].getchannel("A")
        for stage, measured in report["stages"].items():
            box = measured["occupiedBoundsPx"]
            measured["centreDriftPx"] = abs((box[0] + box[2] - base[0] - base[2]) / 2)
            measured["baselineDriftPx"] = abs(box[3] - base[3])
            alpha = normalized[int(stage)].getchannel("A")
            delta, drift = 0, 0
            for y in contract["foundationMaskRowsPx"]:
                want = [x for x in range(width) if expected_alpha.getpixel((x, y))]
                got = [x for x in range(width) if alpha.getpixel((x, y))]
                delta += len(set(want) ^ set(got))
                drift = width if not want or not got else max(drift, *(min(abs(x - z) for z in got) for x in want), *(min(abs(x - z) for z in want) for x in got))
            measured["foundationMaskDifferencePixels"] = delta
            measured["foundationMaskMaxDriftPx"] = drift
            if measured["centreDriftPx"] > 1 or measured["baselineDriftPx"] > 1 or drift > 1:
                errors.append(f"Stage{stage}: registered foundation/center/baseline drift")
        hashes = [m["runtimeSha256"] for m in report["stages"].values()]
        if len(hashes) != len(set(hashes)):
            errors.append("Duplicate normalized stages")
    sheet = Image.new("RGBA", (64, 24), (126, 147, 88, 255))
    for index, stage in enumerate((3, 4, 5)):
        if stage in normalized:
            sheet.alpha_composite(normalized[stage], (4 + index * 20, 4))
    sheet.save(previews / "stage-sequence.png")
    sheet.resize((512, 192), Image.Resampling.NEAREST).save(previews / "stage-sequence-8x.png")
    review_path = family / "visual-review.json"
    if args.require_review:
        review = json.loads(review_path.read_text()) if review_path.exists() else {}
        for stage, measured in report["stages"].items():
            accepted = review.get("stages", {}).get(stage, {})
            if not accepted.get("accepted") or any(accepted.get(k) != measured[k] for k in ("sourceSha256", "runtimeSha256")):
                errors.append(f"Stage{stage}: independent visual review missing or stale")
        for assertion in ("axisAlignedHigh45", "noBakedTerrain", "stageProgressionDistinct", "sameFoundationIdentity"):
            if review.get(assertion) is not True:
                errors.append(f"Visual assertion {assertion} not accepted")
    report["semanticScope"] = "Numeric checks prove frame/alpha/palette/masks, not angle or artistic identity. Fountain water is a conservative color check; final visual review verifies basin, nozzle and construction state. Building roof, room and opening rules do not apply."
    (family / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    return bool(errors)


if __name__ == "__main__":
    raise SystemExit(main())
