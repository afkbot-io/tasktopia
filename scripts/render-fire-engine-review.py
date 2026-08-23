#!/usr/bin/env python3
"""Render native and nearest-neighbour 4× fire-engine scale proofs."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "assets/pixel-city-pack/runtime"
OUTPUT = ROOT / "screenshots/fire-engine-family-review.png"
BACKGROUND = (18, 38, 43, 255)
ROAD = (49, 64, 77, 255)
ROAD_DOT = (58, 76, 89, 255)
TEXT = (225, 232, 222, 255)
MUTED = (147, 168, 166, 255)


def road_panel(width: int, height: int, cell: int) -> Image.Image:
    panel = Image.new("RGBA", (width, height), ROAD)
    draw = ImageDraw.Draw(panel)
    for y in range(3, height, cell):
        for x in range((y // cell) % 2 * 3, width, cell):
            draw.point((x, y), fill=ROAD_DOT)
    return panel


def main() -> None:
    keys = (
        ("fire-engine-horizontal", "PUMPER"),
        ("fire-engine-rescue", "RESCUE"),
        ("fire-engine-ladder", "LADDER"),
    )
    images = [(label, Image.open(RUNTIME / "props" / f"{key}.png").convert("RGBA")) for key, label in keys]
    car = Image.open(RUNTIME / "vehicles/sedan-red-horizontal.png").convert("RGBA")
    bus = Image.open(RUNTIME / "props/city-bus-horizontal.png").convert("RGBA")
    sheet = Image.new("RGBA", (900, 560), BACKGROUND)
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    draw.text((20, 16), "TASKTOPIA FIRE ENGINE FAMILY - NATIVE 1x / NEAREST 4x", fill=TEXT, font=font)

    for row, (label, image) in enumerate(images):
        top = 48 + row * 128
        draw.text((20, top), label, fill=TEXT, font=font)
        native_panel = road_panel(132, 32, 8)
        native_panel.alpha_composite(image, (8, 8))
        sheet.alpha_composite(native_panel, (20, top + 18))
        draw.text((20, top + 54), "native 48x16 / body 46x14", fill=MUTED, font=font)

        scale = 4
        large_panel = road_panel(244, 80, 32)
        large = image.resize((image.width * scale, image.height * scale), Image.Resampling.NEAREST)
        large_panel.alpha_composite(large, (16, 8))
        sheet.alpha_composite(large_panel, (190, top + 8))
        draw.text((450, top + 36), "4x nearest", fill=MUTED, font=font)

    comparison_y = 448
    draw.text((20, comparison_y), "SCALE: CAR 24x16  |  FIRE 48x16  |  BUS 56x24", fill=TEXT, font=font)
    comparison = road_panel(560, 80, 32)
    scale = 3
    x = 18
    for image in (car, images[0][1], bus):
        large = image.resize((image.width * scale, image.height * scale), Image.Resampling.NEAREST)
        comparison.alpha_composite(large, (x, 80 - large.height - 8))
        x += large.width + 28
    sheet.alpha_composite(comparison, (20, comparison_y + 18))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(OUTPUT, optimize=True)
    print(OUTPUT)


if __name__ == "__main__":
    main()
