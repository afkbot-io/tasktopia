"""Verify and preview the two native block-v1 4px base surfaces."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "assets" / "pixel-city-pack"
RUNTIME = PACK / "runtime"
EXPECTED_KEYS = ("block-lawn", "block-water")
EXPECTED_PROFILE = "TASKTOPIA_BLOCK_V1_MICRO_SURFACES_2026"
CELL = 4


def verify() -> tuple[dict, dict[str, Image.Image]]:
    manifest = json.loads((PACK / "manifest.json").read_text(encoding="utf-8"))
    section = manifest["blockSurfaces"]
    assert section["schemaVersion"] == 1
    assert section["cellPx"] == CELL
    assert section["visualProfile"] == EXPECTED_PROFILE
    assert tuple(section["tiles"]) == EXPECTED_KEYS

    images: dict[str, Image.Image] = {}
    report: dict[str, object] = {"profile": EXPECTED_PROFILE, "cellPx": CELL, "tiles": {}}
    for key in EXPECTED_KEYS:
        entry = section["tiles"][key]
        image = Image.open(RUNTIME / entry["path"]).convert("RGBA")
        assert image.size == (CELL, CELL), (key, image.size)
        assert entry["size"] == [CELL, CELL]
        assert entry["opaque"] is True
        assert image.getchannel("A").getextrema() == (255, 255), key
        colors = image.getcolors(maxcolors=256) or []
        assert len(colors) <= 3, (key, len(colors))
        pixels = image.load()
        assert all(pixels[x, 0] == pixels[x, CELL - 1] for x in range(CELL)), (key, "vertical seam")
        assert all(pixels[0, y] == pixels[CELL - 1, y] for y in range(CELL)), (key, "horizontal seam")
        images[key] = image
        report["tiles"][key] = {
            "path": entry["path"],
            "size": list(image.size),
            "colors": len(colors),
            "opaque": True,
            "seamless": True,
        }
    return report, images


def repeated_field(tile: Image.Image, width: int, height: int) -> Image.Image:
    image = Image.new("RGBA", (width, height))
    for y in range(0, height, CELL):
        for x in range(0, width, CELL):
            image.alpha_composite(tile, (x, y))
    return image


def render_preview(images: dict[str, Image.Image], output: Path) -> None:
    background = (12, 31, 35, 255)
    panel = (21, 49, 52, 255)
    label = (218, 224, 207, 255)
    muted = (135, 157, 151, 255)
    canvas = Image.new("RGBA", (720, 360), background)
    draw = ImageDraw.Draw(canvas)
    draw.text((24, 18), "BLOCK-V1 4PX FULL SURFACES", fill=label)
    draw.text((24, 38), "native repeated field + nearest-neighbour 4x", fill=muted)

    for index, key in enumerate(EXPECTED_KEYS):
        left = 24 + index * 348
        draw.rounded_rectangle((left, 66, left + 324, 334), radius=8, fill=panel)
        draw.text((left + 16, 80), key.upper(), fill=label)

        native = repeated_field(images[key], 64, 64)
        canvas.alpha_composite(native, (left + 16, 108))
        draw.text((left + 16, 178), "64x64 native field", fill=muted)

        enlarged = native.resize((256, 256), Image.Resampling.NEAREST).crop((0, 0, 256, 128))
        canvas.alpha_composite(enlarged, (left + 16, 198))
        draw.rectangle((left + 15, 197, left + 272, 327), outline=muted, width=1)

    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--preview", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    report, images = verify()
    if args.preview:
        render_preview(images, args.preview)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
