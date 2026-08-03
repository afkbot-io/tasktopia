"""Split generated chroma-key atlases into uniform transparent runtime sprites."""

from __future__ import annotations

import json
from collections import deque
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ASSET_ROOT = ROOT / "assets" / "generated-v2"
CELL_SIZE = 320

ATLASES = [
    {
        "source": "environment-atlas.png",
        "directory": "environment",
        "columns": 4,
        "rows": 4,
        "names": [
            "grass", "meadow", "forest", "rocks",
            "water", "river-nw-se", "river-w-e", "river-confluence",
            "road-w-e", "road-nw-se", "road-curve", "road-t",
            "road-cross", "bridge", "civic-plaza", "park",
        ],
    },
    {
        "source": "buildings-atlas.png",
        "directory": "buildings",
        "columns": 4,
        "rows": 4,
        "names": [
            "cottage", "townhouse", "apartments", "apartment-tower",
            "corner-shop", "supermarket", "office", "hotel",
            "police", "fire-station", "clinic", "school",
            "theatre", "library", "gas-station", "workshop",
        ],
    },
    {
        "source": "cottage-stages.png",
        "directory": "stages",
        "columns": 5,
        "rows": 1,
        "names": [f"cottage-stage-{stage}" for stage in range(1, 6)],
    },
    {
        "source": "apartments-stages.png",
        "directory": "stages",
        "columns": 5,
        "rows": 1,
        "names": [f"apartments-stage-{stage}" for stage in range(1, 6)],
    },
    {
        "source": "fire-station-stages.png",
        "directory": "stages",
        "columns": 5,
        "rows": 1,
        "names": [f"fire-station-stage-{stage}" for stage in range(1, 6)],
    },
    {
        "source": "supermarket-stages.png",
        "directory": "stages",
        "columns": 5,
        "rows": 1,
        "names": [f"supermarket-stage-{stage}" for stage in range(1, 6)],
    },
]


def keep_largest_component(sprite: Image.Image) -> Image.Image:
    """Remove fragments from neighboring atlas cells while preserving the central sprite."""
    alpha = sprite.getchannel("A")
    width, height = alpha.size
    values = alpha.load()
    visited = bytearray(width * height)
    largest: list[tuple[int, int]] = []

    for y in range(height):
        for x in range(width):
            offset = y * width + x
            if visited[offset] or values[x, y] <= 8:
                continue
            queue = deque([(x, y)])
            visited[offset] = 1
            component: list[tuple[int, int]] = []
            while queue:
                current_x, current_y = queue.popleft()
                component.append((current_x, current_y))
                for delta_x, delta_y in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)):
                    next_x, next_y = current_x + delta_x, current_y + delta_y
                    if not (0 <= next_x < width and 0 <= next_y < height):
                        continue
                    next_offset = next_y * width + next_x
                    if visited[next_offset] or values[next_x, next_y] <= 8:
                        continue
                    visited[next_offset] = 1
                    queue.append((next_x, next_y))
            if len(component) > len(largest):
                largest = component

    if not largest:
        return sprite
    cleaned_alpha = Image.new("L", (width, height), 0)
    cleaned_values = cleaned_alpha.load()
    for x, y in largest:
        cleaned_values[x, y] = values[x, y]
    cleaned = sprite.copy()
    cleaned.putalpha(cleaned_alpha)
    return cleaned


def split_atlas(spec: dict[str, object]) -> list[dict[str, object]]:
    source = ASSET_ROOT / "source" / str(spec["source"])
    output = ASSET_ROOT / "tiles" / str(spec["directory"])
    output.mkdir(parents=True, exist_ok=True)
    image = Image.open(source).convert("RGBA")
    columns = int(spec["columns"])
    rows = int(spec["rows"])
    names = list(spec["names"])
    records: list[dict[str, object]] = []

    for index, name in enumerate(names):
        column = index % columns
        row = index // columns
        left = round(column * image.width / columns)
        top = round(row * image.height / rows)
        right = round((column + 1) * image.width / columns)
        bottom = round((row + 1) * image.height / rows)
        sprite = image.crop((left, top, right, bottom)).resize((CELL_SIZE, CELL_SIZE), Image.Resampling.LANCZOS)
        sprite = keep_largest_component(sprite)
        alpha = sprite.getchannel("A")
        bbox = alpha.getbbox()
        if bbox is None:
            raise RuntimeError(f"{name}: generated an empty sprite")
        if alpha.getpixel((0, 0)) > 8 or alpha.getpixel((CELL_SIZE - 1, CELL_SIZE - 1)) > 8:
            raise RuntimeError(f"{name}: chroma key leaked into a corner")
        destination = output / f"{name}.png"
        sprite.save(destination, optimize=True)
        records.append({
            "key": name,
            "path": destination.relative_to(ROOT).as_posix(),
            "size": [CELL_SIZE, CELL_SIZE],
            "contentBounds": list(bbox),
            "source": "generated-2d",
        })
    return records


def main() -> None:
    manifest = {
        "version": 2,
        "orientation": "POINTY_TOP",
        "cellSize": CELL_SIZE,
        "camera": "terrain top-down; buildings restrained pseudo-isometric",
        "lightDirection": "upper-left",
        "atlases": {},
    }
    for atlas in ATLASES:
        manifest["atlases"].setdefault(str(atlas["directory"]), []).extend(split_atlas(atlas))
    destination = ASSET_ROOT / "manifest.json"
    destination.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {sum(len(entries) for entries in manifest['atlases'].values())} sprites and {destination.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
