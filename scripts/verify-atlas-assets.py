#!/usr/bin/env python3
"""Read-only validation for generated atlas aircraft, cloud and airport sprites."""

from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ATLAS = ROOT / "public" / "game-assets" / "v5" / "atlas"


def verify(path, size):
    image = Image.open(path).convert("RGBA")
    assert image.size == size, f"{path}: expected {size}, got {image.size}"
    assert image.getchannel("A").getbbox(), f"{path}: empty alpha"
    assert set(image.getchannel("A").getdata()) <= {0, 255}, f"{path}: soft alpha"
    return image.tobytes()


def main() -> None:
    aircraft = []
    for model in range(1, 9):
        frames = [verify(ATLAS / "aircraft" / f"airplane-model-{model}-frame-{frame}.png", (48, 32)) for frame in range(1, 3)]
        assert frames[0] != frames[1], f"aircraft model {model}: animation frames are identical"
        aircraft.append(frames[0])
    assert len(set(aircraft)) == 8, "aircraft models must have distinct silhouettes"
    for family in ("planet", "country"):
        clouds = [verify(ATLAS / "clouds" / f"cloud-{family}-{variant}.png", (96, 48)) for variant in range(1, 9)]
        assert len(set(clouds)) == 8, f"{family} clouds must be distinct"
    terminals = [verify(ATLAS / "airport" / f"airport-terminal-{variant}.png", (192, 96)) for variant in range(1, 6)]
    supports = [verify(ATLAS / "airport" / f"airport-support-{variant}.png", (128, 80)) for variant in range(1, 9)]
    assert len(set(terminals)) == 5, "airport terminals must be distinct"
    assert len(set(supports)) == 8, "airport support structures must be distinct"
    print("atlas assets: 8 aircraft x2, 16 clouds, 5 terminals, 8 support structures verified")


if __name__ == "__main__":
    main()
