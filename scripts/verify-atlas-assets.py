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
    terrain_names = ("grass", "meadow", "forest", "hill", "mountain", "coast", "river", "stone")
    terrain = [verify(ATLAS / "terrain-v2" / f"planet-{name}.png", (16, 16)) for name in terrain_names]
    assert len(set(terrain)) == 8, "planet terrain sprites must be distinct"
    square_terrain = []
    for name in terrain_names:
        path = ATLAS / "terrain-v3" / f"planet-{name}.png"
        square_terrain.append(verify(path, (16, 16)))
        assert set(Image.open(path).convert("RGBA").getchannel("A").getdata()) == {255}, f"{path}: square tile must fill every pixel"
    assert len(set(square_terrain)) == 8, "planet V3 square terrain sprites must be distinct"
    planet_aircraft = []
    for model in range(1, 9):
        frames = [verify(ATLAS / "aircraft-v2" / f"airplane-topdown-{model}-frame-{frame}.png", (24, 16)) for frame in range(1, 3)]
        assert frames[0] != frames[1], f"planet aircraft model {model}: animation frames are identical"
        planet_aircraft.append(frames[0])
    assert len(set(planet_aircraft)) == 8, "planet aircraft models must be distinct"
    planet_clouds = [verify(ATLAS / "clouds-v2" / f"cloud-topdown-{variant}.png", (64, 32)) for variant in range(1, 9)]
    assert len(set(planet_clouds)) == 8, "planet V2 clouds must be distinct"
    aircraft_v4 = [verify(ATLAS / "aircraft-v4" / f"airplane-topdown-{variant}.png", (24, 16)) for variant in range(1, 9)]
    assert len(set(aircraft_v4)) == 8, "planet V4 aircraft must be distinct"
    print("atlas assets: V1 + V2/V3 terrain, 8 V4 top-down aircraft and 8 shared top-down clouds verified")


if __name__ == "__main__":
    main()
