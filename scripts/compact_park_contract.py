"""Publish approved task-park layers unchanged; terrain/fences stay code-native."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

from PIL import Image

FAMILIES = ("compact-park-fountain-v1", "compact-park-monument-v1")
PROFILE = "TASKTOPIA_COMPACT_PARK_HIGH_45_V1"


def publish_compact_parks(root: Path, manifest: dict) -> None:
    pack = root / "assets/pixel-city-pack"
    catalog_path = pack / "catalog/ai-authored-props.json"
    catalog = json.loads(catalog_path.read_text())
    # One reviewed normalizer, parameterized by a family-local fixed frame.
    verifier = pack / "reference/ai-authored/compact-park-fountain-v1/normalize-verify.py"
    for key in FAMILIES:
        family = pack / "reference/ai-authored" / key
        subprocess.run([sys.executable, str(verifier), "--family", str(family),
                        "--require-complete", "--require-review"], check=True, stdout=subprocess.DEVNULL)
        geometry = json.loads((family / "geometry.json").read_text())
        report = json.loads((family / "report.json").read_text())
        if report["errors"] or any(geometry[field] != expected for field, expected in (
            ("visualProfile", PROFILE), ("spriteSize", [16, 16]), ("footprintCells", [2, 2]), ("anchorPx", [8, 16]),
        )):
            raise ValueError(f"Invalid compact public-space contract: {key}")
        for stage in (3, 4, 5):
            runtime_key = f"{key.removesuffix('-v1')}-stage-{stage}"
            normalized = family / "normalized" / f"stage-{stage}.png"
            expected = report["stages"][str(stage)]["runtimeSha256"]
            if hashlib.sha256(normalized.read_bytes()).hexdigest() != expected:
                raise ValueError(f"Stale park normalization: {runtime_key}")
            with Image.open(normalized) as image:
                if image.size != (16, 16):
                    raise ValueError(f"Invalid park dimensions: {runtime_key}")
            path = f"props/{runtime_key}.png"
            for base in (pack / "runtime", root / "public/game-assets/v5"):
                target = base / path
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(normalized, target)
            sheet = f"ai-authored/{key}/sources/stage-{stage}.png"
            label = ("Фонтан" if geometry["assetRole"] == "FOUNTAIN" else "Памятник") + f" · стадия {stage}"
            manifest["props"][runtime_key] = {
                "label": label, "path": path, "size": [16, 16], "anchorPx": [8, 16], "footprintCells": [2, 2],
                "artSource": "AI_AUTHORED", "sourceSheet": sheet, "visualProfile": PROFILE,
            }
            catalog = [entry for entry in catalog if entry["key"] != runtime_key]
            catalog.append({"key": runtime_key, "label": label, "sheet": sheet, "size": [16, 16],
                            "footprintCells": [2, 2], "anchorPx": [8, 16], "reviewed": True,
                            "visualProfile": PROFILE, "stage": stage,
                            "sourceSha256": report["stages"][str(stage)]["sourceSha256"]})
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n")
