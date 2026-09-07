#!/usr/bin/env python3
"""Normalize new AI-authored top-down micro subjects; never repaint geometry.

Each direction is independently authored in a source sheet. Normalization only
extracts its declared cell, removes soft transparency, preserves aspect ratio,
samples nearest pixels and limits the palette. Runtime never scales old art.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path

from PIL import Image

from micro_ambient_contract import PERSON_OCCUPIED_BOUNDS

ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "assets/pixel-city-pack"
FAMILY = PACK / "reference/ai-authored/micro-ambient-v1"
PROFILE = "TASKTOPIA_MICRO_TOPDOWN_CARTOON_V1"
DIRECTIONS = ("north", "east", "south", "west")
SHEETS = {
    "cars": {"grid": (4, 4), "variants": ("blue", "red", "taxi", "van"), "kind": "car", "canvas": 8},
    "people": {"grid": (2, 4), "variants": ("ochre", "teal"), "kind": "person", "canvas": 8, "source": "people-v2.png"},
    "animals": {"grid": (4, 2), "variants": ("fox", "deer", "rabbit", "boar", "duck", "sheep", "dog", "cat"), "kind": "animal", "canvas": 8},
    "aircraft": {"grid": (2, 2), "variants": ("regional",), "kind": "aircraft", "canvas": 16},
}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def normalize(cell: Image.Image, canvas: int, envelope: tuple[int, int]) -> Image.Image:
    alpha = Image.new("L", cell.size)
    alpha.putdata([255 if a >= 192 and not (r > g + 60 and b > g + 60) else 0
                   for r, g, b, a in cell.getdata()])
    cell.putalpha(alpha)
    bounds = alpha.getbbox()
    if bounds is None:
        raise ValueError("Empty authored cell")
    subject = cell.crop(bounds)
    scale = min(envelope[0] / subject.width, envelope[1] / subject.height)
    size = (max(1, round(subject.width * scale)), max(1, round(subject.height * scale)))
    subject = subject.resize(size, Image.Resampling.NEAREST)
    alpha = subject.getchannel("A")
    # Hidden chroma must not consume the opaque palette or tint edge clusters.
    first = next((r, g, b) for r, g, b, a in subject.getdata() if a)
    rgb = Image.new("RGB", subject.size, first)
    rgb.paste(subject.convert("RGB"), mask=alpha)
    subject = rgb.quantize(colors=8, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert("RGBA")
    subject.putalpha(alpha)
    result = Image.new("RGBA", (canvas, canvas))
    result.alpha_composite(subject, ((canvas - size[0]) // 2, (canvas - size[1]) // 2))
    if result.getchannel("A").getbbox() is None:
        raise ValueError("Empty normalized subject")
    return result


def build(only_family: str | None = None) -> dict:
    fragment = PACK / "micro-ambient-manifest.json"
    existing = json.loads(fragment.read_text()) if only_family else {}
    sprites = existing.get("sprites", {})
    sources = existing.get("sources", {})
    pending = {}
    for family, spec in SHEETS.items():
        if only_family and family != only_family:
            continue
        source = FAMILY / "sources" / spec.get("source", f"{family}.png")
        image = Image.open(source).convert("RGBA")
        columns, rows = spec["grid"]
        sources[family] = {"path": str(source.relative_to(PACK)), "sha256": digest(source), "grid": [columns, rows]}
        if family == "people":
            sources[family].update({"revision": 2, "provenance": str((FAMILY / "people-v2-provenance.json").relative_to(PACK))})
        for row in range(rows):
            for column in range(columns):
                if family == "animals":
                    variant = spec["variants"][row * columns + column]
                    direction = "static"
                    envelope = (6, 6)
                elif family == "aircraft":
                    variant = "regional"
                    direction = DIRECTIONS[row * columns + column]
                    envelope = (12, 12)
                else:
                    variant = spec["variants"][column]
                    direction = DIRECTIONS[row]
                    envelope = ((6, 4) if direction in ("east", "west") else (4, 6)) if family == "cars" else (3, 4)
                cell_bounds = [round(column * image.width / columns), round(row * image.height / rows), round((column + 1) * image.width / columns), round((row + 1) * image.height / rows)]
                normalized = normalize(image.crop(cell_bounds), spec["canvas"], envelope)
                key = f"micro-{spec['kind']}-{variant}-{direction}"
                if family == "people" and normalized.getchannel("A").getbbox() != PERSON_OCCUPIED_BOUNDS:
                    raise ValueError(f"{key}: authored person registration must remain 3x4 at {PERSON_OCCUPIED_BOUNDS}")
                relative = f"micro-ambient/{key}.png"
                encoded = io.BytesIO()
                normalized.save(encoded, format="PNG", optimize=True)
                pending[relative] = encoded.getvalue()
                sprites[key] = {
                    "path": relative, "kind": spec["kind"], "variant": variant, "direction": direction,
                    "size": [spec["canvas"], spec["canvas"]], "anchorPx": [spec["canvas"] // 2, spec["canvas"] // 2],
                    "opaqueBounds": list(normalized.getchannel("A").getbbox()), "frameCount": 1,
                    "sourceFamily": family, "sourceCell": [column, row], "sourceCellBounds": cell_bounds,
                    "sha256": hashlib.sha256(pending[relative]).hexdigest(),
                }
    # Validate the complete selection before changing any published image. A
    # drifting last heading must not leave seven new people and one old person.
    for relative, content in pending.items():
        for base in (PACK / "runtime", ROOT / "public/game-assets/v5"):
            target = base / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
    manifest = {"schemaVersion": 1, "visualProfile": PROFILE, "cellSizePx": 8, "artSource": "AI_AUTHORED", "sources": sources, "sprites": sprites}
    write_json(PACK / "micro-ambient-manifest.json", manifest)
    sheet = Image.new("RGBA", (16 * 12, 16 * 3), "#81955c")
    for index, entry in enumerate(sprites.values()):
        image = Image.open(PACK / "runtime" / entry["path"]).convert("RGBA")
        sheet.alpha_composite(image, ((index % 12) * 16 + (16 - image.width) // 2, (index // 12) * 16 + (16 - image.height) // 2))
    preview = ROOT / "screenshots/micro-ambient-v1.png"
    sheet.resize((sheet.width * 6, sheet.height * 6), Image.Resampling.NEAREST).save(preview)
    return manifest


def draft_people(source: Path, directory: Path) -> dict:
    """Show native normalization without publishing or approving a source."""
    directory.mkdir(parents=True, exist_ok=True)
    source_image = Image.open(source).convert("RGBA")
    sheet = Image.new("RGBA", (32, 64), "#81955c")
    bounds = {}
    for row, direction in enumerate(DIRECTIONS):
        for column, variant in enumerate(SHEETS["people"]["variants"]):
            cell = source_image.crop((round(column * source_image.width / 2),
                                      round(row * source_image.height / 4),
                                      round((column + 1) * source_image.width / 2),
                                      round((row + 1) * source_image.height / 4)))
            normalized = normalize(cell, 8, (3, 4))
            key = f"micro-person-{variant}-{direction}"
            normalized.save(directory / f"{key}.png", optimize=True)
            bounds[key] = list(normalized.getchannel("A").getbbox())
            sheet.alpha_composite(normalized, (column * 16 + 4, row * 16 + 4))
    sheet.resize((512, 1024), Image.Resampling.NEAREST).save(directory / "preview-16x.png")
    return {"source": str(source), "occupiedBounds": bounds}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--build", action="store_true", help="Normalize the accepted authored source sheets")
    parser.add_argument("--family", choices=tuple(SHEETS), help="Publish only this family; leave every other PNG and entry unchanged")
    parser.add_argument("--draft-people-source", type=Path, help="Normalize a people candidate without changing published assets")
    parser.add_argument("--draft-directory", type=Path)
    args = parser.parse_args()
    if args.draft_people_source:
        if not args.draft_directory or args.build:
            parser.error("--draft-people-source requires --draft-directory and cannot publish")
        print(json.dumps(draft_people(args.draft_people_source, args.draft_directory)))
    elif args.build:
        result = build(args.family)
        print(json.dumps({"sprites": len(result["sprites"]), "profile": PROFILE}))
