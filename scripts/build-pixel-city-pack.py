#!/usr/bin/env python3
"""Publish the compact city family and preserve the approved terrain/ambient pack.

Building art is copied only from the separately reviewed 5→4→3 sources. Stages
1–2 are catalog thumbnails of the shared kit; the world composes the full site
with its one-cell fence clearance directly from construction-stage.ts.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image
from micro_ambient_contract import publish_micro_ambient
from compact_park_contract import publish_compact_parks
from compact_tree_contract import publish_compact_trees
from courtyard_furniture_contract import publish_courtyard_furniture


ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "assets" / "pixel-city-pack"
RUNTIME = PACK / "runtime"
PUBLIC = ROOT / "public" / "game-assets" / "v5"
CATALOG = PACK / "catalog"
PROFILE = "TASKTOPIA_COMPACT_CARTOON_HIGH_45_V1"


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def save(image: Image.Image, relative: str) -> None:
    for base in (RUNTIME, PUBLIC):
        target = base / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        image.save(target, optimize=True)


def retired_paths(active_keys: set[str]) -> list[Path]:
    """Exact obsolete targets; unrelated reviewed terrain and ambient remain intact."""
    result = []
    for base in (RUNTIME, PUBLIC):
        for category in (base / "buildings").glob("*"):
            if category.is_dir():
                result.extend(path for path in category.iterdir() if path.is_dir() and path.name not in active_keys)
        for section in ("tiles", "props"):
            result.extend((base / section).glob("construction-*.png"))
        for kind in ("flame", "smoke"):
            for frame in "abcd":
                path = base / "props" / f"incident-{kind}-{frame}.png"
                if path.exists():
                    result.append(path)
    result.extend(path for path in (
        PACK / "reference" / "ai-authored" / "building-stage-study",
        PACK / "reference" / "ai-authored" / "construction",
    ) if path.exists())
    return result


def retire_legacy(active_keys: set[str]) -> str | None:
    paths = retired_paths(active_keys)
    if not paths:
        return None
    backup = Path(tempfile.mkdtemp(prefix="tasktopia-retired-building-art-"))
    for path in paths:
        # Preserve hierarchy in an external recoverable archive, never recursive-delete.
        relative = path.relative_to(ROOT)
        target = backup / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(path), str(target))
    return str(backup)


def composition_previews(manifest: dict, entry: dict) -> list[Image.Image]:
    width, depth = entry["footprintCells"]
    entrance = entry["entrances"][0]["offset"]
    command = [str(ROOT / "node_modules" / ".bin" / "tsx"), "-e", (
        "import {constructionStageLayout,CONSTRUCTION_DETAIL_SPEC_BY_KEY} from './src/shared/construction-stage.ts';"
        f"console.log(JSON.stringify({{layouts:[1,2].map(stage=>constructionStageLayout({{width:{width},height:{depth}}},{entrance},stage,1)),specs:CONSTRUCTION_DETAIL_SPEC_BY_KEY}}));"
    )]
    data = json.loads(subprocess.check_output(command, cwd=ROOT, text=True))
    previews = []
    for layout in data["layouts"]:
        image = Image.new("RGBA", ((width + 2) * 8, (depth + 2) * 8))
        for layer in ("rearFence", "site"):
            for tile in layout[layer]:
                sprite = Image.open(RUNTIME / manifest["tiles"][tile["key"]]["path"]).convert("RGBA")
                sprite = sprite.rotate(-90 * tile.get("quarterTurns", 0))
                image.alpha_composite(sprite, ((tile["x"] + 1) * 8, (tile["y"] + depth + 1) * 8))
        for detail in layout["details"]:
            spec = data["specs"][detail["key"]]
            sprite = Image.open(RUNTIME / manifest["props"][detail["key"]]["path"]).convert("RGBA")
            x = (detail["x"] + 1 + spec["footprint"]["width"] / 2) * 8 - sprite.width / 2
            y = (detail["y"] + depth + 1 + spec["footprint"]["height"]) * 8 - sprite.height
            image.alpha_composite(sprite, (int(x), int(y)))
        for tile in layout["frontFence"]:
            sprite = Image.open(RUNTIME / manifest["tiles"][tile["key"]]["path"]).convert("RGBA")
            sprite = sprite.rotate(-90 * tile.get("quarterTurns", 0))
            image.alpha_composite(sprite, ((tile["x"] + 1) * 8, (tile["y"] + depth + 1) * 8))
        # Thumbnail-only normalization; the live world never scales this bitmap.
        bounds = image.getchannel("A").getbbox()
        cropped = image.crop(bounds)
        target_width, target_height = entry["spriteSize"]
        scale = min(target_width / cropped.width, target_height / cropped.height)
        resized = cropped.resize((round(cropped.width * scale), round(cropped.height * scale)), Image.Resampling.NEAREST)
        thumbnail = Image.new("RGBA", (target_width, target_height))
        thumbnail.alpha_composite(resized, ((target_width - resized.width) // 2, target_height - resized.height))
        previews.append(thumbnail)
    return previews


def pack_props(manifest: dict) -> None:
    images = {key: Image.open(RUNTIME / prop["path"]).convert("RGBA") for key, prop in manifest["props"].items()}
    ordered = sorted(images, key=lambda key: (-images[key].height, -images[key].width, key))
    frames = {}
    x, y, shelf = 1, 1, 0
    for key in ordered:
        image = images[key]
        if image.width > 510:
            raise ValueError(f"{key}: exceeds prop atlas width")
        if x + image.width + 1 > 512:
            x, y, shelf = 1, y + shelf + 1, 0
        frames[key] = {"x": x, "y": y, "width": image.width, "height": image.height}
        x += image.width + 1
        shelf = max(shelf, image.height)
    height = 1 << (y + shelf).bit_length()
    if height > 2048:
        raise ValueError("Prop atlas exceeds 2048px budget")
    atlas = Image.new("RGBA", (512, height))
    for key in ordered:
        atlas.alpha_composite(images[key], (frames[key]["x"], frames[key]["y"]))
    save(atlas, "atlas/props-v1.png")
    manifest["propAtlas"] = {"path": "atlas/props-v1.png", "size": [512, height], "frames": frames}


def building_contact_sheet(family_images: list[list[Image.Image]]) -> Image.Image:
    """Compose native-size stages; this is review evidence, never runtime art."""
    # Keep the accepted 48px layout, but allocate enough room for larger
    # families. A tall row must not paint over the family above it.
    column_width = max([48] + [image.width for family in family_images for image in family]) + 8
    row_heights = [max([48] + [image.height for image in family]) for family in family_images]
    sheet = Image.new("RGBA", (5 * column_width, 8 + sum(height + 8 for height in row_heights)), "#81975b")
    top = 8
    for row_height, stage_images in zip(row_heights, family_images):
        for index, image in enumerate(stage_images):
            sheet.alpha_composite(image, (index * column_width + (column_width - image.width) // 2,
                                          top + row_height - image.height))
        top += row_height + 8
    return sheet


def main() -> None:
    subprocess.run([sys.executable, str(ROOT / "scripts" / "verify-compact-building-art.py"), "--require-complete", "--require-review"], cwd=ROOT, check=True)
    catalog = json.loads((CATALOG / "buildings.json").read_text())
    entries = catalog["buildings"]
    if not entries or catalog.get("projectionProfile") != PROFILE:
        raise ValueError("Reviewed compact building catalog required")
    for entry in entries:
        family = PACK / "reference" / "ai-authored" / entry["key"]
        geometry = json.loads((family / "geometry.json").read_text())
        for field in ("spriteSize", "footprintCells", "anchorPx", "entrances"):
            if entry.get(field) != geometry[field]:
                raise ValueError(f"{entry['key']}: catalog {field} differs from authored contract")
        if not entry.get("reviewed") or entry["stageSha256"] != [hashlib.sha256((family / "sources" / f"stage-{stage}.png").read_bytes()).hexdigest() for stage in (3, 4, 5)]:
            raise ValueError(f"{entry['key']}: stale catalog provenance")
    manifest = json.loads((PACK / "manifest.json").read_text())
    preserved_sections = {key: manifest[key] for key in ("terrain", "transitions", "blockSurfaces")}
    backup = retire_legacy({entry["key"] for entry in entries})
    subprocess.run([sys.executable, str(ROOT / "scripts" / "build-compact-construction-kit.py")], cwd=ROOT, check=True)
    fragment = json.loads((PACK / "compact-kit-manifest.json").read_text())
    for section in ("tiles", "props"):
        manifest[section] = {key: value for key, value in manifest[section].items()
                             if not key.startswith(("construction-", "incident-flame-", "incident-smoke-"))}
        manifest[section].update(fragment[section])
    authored_props = json.loads((CATALOG / "ai-authored-props.json").read_text())
    write_json(CATALOG / "ai-authored-props.json", [prop for prop in authored_props if not prop["key"].startswith("construction-")])
    manifest["buildings"] = {}
    family_images = []
    for entry in entries:
        key = entry["key"]
        family = PACK / "reference" / "ai-authored" / key
        building_path = f"buildings/{entry['category'].lower()}/{key}"
        stage_images = composition_previews(manifest, entry) + [Image.open(family / "normalized" / f"stage-{stage}.png").convert("RGBA") for stage in (3, 4, 5)]
        for stage, image in enumerate(stage_images, 1):
            relative = f"{building_path}/stage-{stage}.png"
            if stage <= 2:
                save(image, relative)
            else:
                for base in (RUNTIME, PUBLIC):
                    target = base / relative
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(family / "normalized" / f"stage-{stage}.png", target)
        published = {field: value for field, value in entry.items() if field not in ("key", "stageSources", "stageSha256", "reviewed")}
        published["stages"] = [f"{building_path}/stage-{stage}.png" for stage in range(1, 6)]
        published["stageOpaqueBounds"] = [list(image.getchannel("A").getbbox()) for image in stage_images]
        manifest["buildings"][key] = published
        family_images.append(stage_images)
    publish_compact_parks(ROOT, manifest)
    publish_compact_trees(ROOT, manifest)
    publish_courtyard_furniture(ROOT, manifest)
    pack_props(manifest)
    publish_micro_ambient(manifest, RUNTIME, PACK)
    manifest["generator"] = "scripts/build-pixel-city-pack.py"
    manifest["buildingProfile"] = PROFILE
    if any(manifest[key] != value for key, value in preserved_sections.items()):
        raise ValueError("Publisher changed accepted terrain/ambient metadata")
    digest = hashlib.sha256()
    for path in sorted(PUBLIC.rglob("*.png")):
        digest.update(str(path.relative_to(PUBLIC)).encode())
        digest.update(path.read_bytes())
    manifest["assetRevision"] = digest.hexdigest()[:16]
    write_json(PACK / "manifest.json", manifest)
    write_json(PUBLIC / "manifest.json", manifest)
    sheet = building_contact_sheet(family_images)
    review = ROOT / "screenshots" / "compact-building-five-stages.png"
    sheet.resize((sheet.width * 4, sheet.height * 4), Image.Resampling.NEAREST).save(review)
    print(json.dumps({"buildings": len(entries), "props": len(manifest["props"]), "retiredArtBackup": backup, "review": str(review), "assetRevision": manifest["assetRevision"]}))


if __name__ == "__main__":
    main()
