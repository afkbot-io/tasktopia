#!/usr/bin/env python3
"""Verify Tasktopia moving-agent frame geometry and optionally render GIF proofs."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "assets/pixel-city-pack/runtime/props"
CATALOG = ROOT / "assets/pixel-city-pack/catalog/ai-authored-props.json"


def alpha_bounds(image: Image.Image) -> tuple[int, int, int, int]:
    bounds = image.getchannel("A").getbbox()
    if bounds is None:
        raise AssertionError("empty frame")
    return bounds


def assert_no_chroma_matte(image: Image.Image, prefix: str) -> None:
    """Reject studio-key backdrops and their saturated edge halos."""
    matte = []
    for red, green, blue, alpha in image.getdata():
        if alpha == 0:
            continue
        is_green_key = green >= 150 and green >= red * 1.45 and green >= blue * 1.18
        is_magenta_key = red >= 140 and blue >= 120 and red - green >= 55 and blue - green >= 45
        if is_green_key or is_magenta_key:
            matte.append((red, green, blue))
    assert not matte, f"{prefix}: chroma matte leaked into {len(matte)} opaque pixels"


def family_frames(prefix: str) -> list[Image.Image]:
    return [Image.open(RUNTIME / f"{prefix}-{frame}.png").convert("RGBA") for frame in "abc"]


def verify_family(prefix: str, expected_size: tuple[int, int], expected_occupied: tuple[int, int]) -> dict:
    frames = family_frames(prefix)
    bounds = [alpha_bounds(frame) for frame in frames]
    sizes = [frame.size for frame in frames]
    occupied = [(right - left, bottom - top) for left, top, right, bottom in bounds]
    baselines = [bottom for _, _, _, bottom in bounds]
    alpha_modes = [set(frame.getchannel("A").getdata()) for frame in frames]
    hashes = [hash(frame.tobytes()) for frame in frames]
    opaque_points = [
        [(x, y) for y in range(frame.height) for x in range(frame.width) if frame.getpixel((x, y))[3] == 255]
        for frame in frames
    ]
    centroids = [
        (sum(x for x, _ in points) / len(points), sum(y for _, y in points) / len(points))
        for points in opaque_points
    ]
    assert all(size == expected_size for size in sizes), f"{prefix}: canvas drift {sizes}"
    assert all(box == expected_occupied for box in occupied), f"{prefix}: occupied drift {occupied}, expected {expected_occupied}"
    assert len(set(baselines)) == 1, f"{prefix}: baseline drift {baselines}"
    assert all(mode <= {0, 255} for mode in alpha_modes), f"{prefix}: soft alpha"
    for frame in frames:
        assert_no_chroma_matte(frame, prefix)
    assert len(set(hashes)) == 3, f"{prefix}: duplicate gait frames"
    assert max(point[0] for point in centroids) - min(point[0] for point in centroids) <= 1, f"{prefix}: horizontal mass drift {centroids}"
    assert max(point[1] for point in centroids) - min(point[1] for point in centroids) <= 1, f"{prefix}: vertical mass drift {centroids}"
    opaque_counts = [len(points) for points in opaque_points]
    assert max(opaque_counts) / min(opaque_counts) <= 1.35, f"{prefix}: silhouette mass drift {opaque_counts}"
    return {"prefix": prefix, "canvas": expected_size, "occupied": expected_occupied, "baseline": baselines[0]}


def gif_proof(prefix: str, output: Path) -> None:
    frames = family_frames(prefix)
    sequence = [frames[0], frames[1], frames[2], frames[1]]
    scale = 8
    enlarged = [frame.resize((frame.width * scale, frame.height * scale), Image.Resampling.NEAREST) for frame in sequence]
    output.parent.mkdir(parents=True, exist_ok=True)
    enlarged[0].save(output, save_all=True, append_images=enlarged[1:], duration=180, loop=0, disposal=2)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gif-dir", type=Path)
    args = parser.parse_args()
    entries = json.loads(CATALOG.read_text())
    by_key = {entry["key"]: entry for entry in entries}
    prefixes: list[str] = []
    for key in sorted(by_key):
        if not key.endswith("-a") or not key.startswith(("walker-", "cyclist-", "scooter-", "animal-")):
            continue
        prefixes.append(key[:-2])
    report = []
    for prefix in prefixes:
        entry = by_key[f"{prefix}-a"]
        report.append(verify_family(prefix, tuple(entry["size"]), tuple(entry["occupiedSize"])))
        if args.gif_dir:
            gif_proof(prefix, args.gif_dir / f"{prefix}.gif")

    # West is a pure mirror contract, never an independently projected animal.
    for species in ("fox", "deer", "rabbit", "boar", "duck", "sheep", "dog", "cat"):
        for frame in "abc":
            east = Image.open(RUNTIME / f"animal-{species}-east-{frame}.png").convert("RGBA")
            west = Image.open(RUNTIME / f"animal-{species}-west-{frame}.png").convert("RGBA")
            assert ImageChops.difference(east.transpose(Image.Transpose.FLIP_LEFT_RIGHT), west).getbbox() is None, f"{species}-{frame}: west is not east mirror"

    walker_height = by_key["walker-east-a"]["occupiedSize"][1]
    for entry in entries:
        if entry["key"].startswith("animal-"):
            assert entry["occupiedSize"][1] < walker_height, f"{entry['key']}: animal is not smaller than adult"
    print(json.dumps({"families": len(report), "frames": len(report) * 3, "valid": True}, ensure_ascii=False))


if __name__ == "__main__":
    main()
