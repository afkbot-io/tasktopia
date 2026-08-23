#!/usr/bin/env python3
"""Convert an image-generator chroma recovery into a true-alpha stage source."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--trim-opaque-top-rows",
        type=int,
        default=0,
        help="Remove this many source rows from the top of the opaque subject.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    image = Image.open(args.input).convert("RGBA")
    pixels = image.load()
    removed = 0
    for y in range(image.height):
        for x in range(image.width):
            red, green, blue, alpha = pixels[x, y]
            if alpha == 0:
                continue
            # Recovery images use a high-saturation magenta studio matte. The
            # accepted building palette does not use this hue, including the
            # narrow antialiased fringe emitted by the image generator.
            if red >= 140 and blue >= 120 and red - green >= 55 and blue - green >= 45:
                pixels[x, y] = (red, green, blue, 0)
                removed += 1
            else:
                pixels[x, y] = (red, green, blue, 255)
    bounds = image.getchannel("A").getbbox()
    if bounds is None or removed == 0:
        raise ValueError("input does not contain a removable magenta recovery matte")
    if args.trim_opaque_top_rows < 0:
        raise ValueError("--trim-opaque-top-rows must be non-negative")
    if args.trim_opaque_top_rows:
        left, top, right, bottom = bounds
        trim_bottom = min(top + args.trim_opaque_top_rows, bottom)
        for y in range(top, trim_bottom):
            for x in range(left, right):
                red, green, blue, _alpha = pixels[x, y]
                pixels[x, y] = (red, green, blue, 0)
        bounds = image.getchannel("A").getbbox()
        if bounds is None:
            raise ValueError("top-row trim removed the entire subject")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    image.save(args.output, optimize=True)
    print(json.dumps({
        "output": str(args.output),
        "size": list(image.size),
        "opaqueBounds": list(bounds),
        "removedPixels": removed,
        "trimmedOpaqueTopRows": args.trim_opaque_top_rows,
        "alphaExtrema": list(image.getchannel("A").getextrema()),
    }))


if __name__ == "__main__":
    main()
