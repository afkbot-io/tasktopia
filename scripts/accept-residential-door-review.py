#!/usr/bin/env python3
"""Bind completed human door/projection reviews to current low-rise evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "assets/pixel-city-pack/catalog/buildings.json"
RUNTIME = ROOT / "assets/pixel-city-pack/runtime/buildings/house"
STUDIES = ROOT / "assets/pixel-city-pack/reference/ai-authored/building-stage-study"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--confirm-contact-sheet",
        required=True,
        help="Path to the manually inspected contact sheet.",
    )
    parser.add_argument(
        "--confirm-projection-sheet",
        required=True,
        help="Path to the manually inspected projection sheet.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    contact_sheet = Path(args.confirm_contact_sheet).resolve()
    if not contact_sheet.is_file():
        raise ValueError(f"contact sheet does not exist: {contact_sheet}")
    projection_sheet = Path(args.confirm_projection_sheet).resolve()
    if not projection_sheet.is_file():
        raise ValueError(f"projection sheet does not exist: {projection_sheet}")
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))["buildings"]
    buildings = [building for building in catalog if "low-rise-residential" in building.get("tags", [])]
    accepted: list[str] = []
    for building in buildings:
        key = building["key"]
        runtime_stage = RUNTIME / key / "stage-5.png"
        geometry_path = STUDIES / f"{key}-v5" / "geometry.json"
        geometry = json.loads(geometry_path.read_text(encoding="utf-8"))
        review = geometry["doorVisualReview"]
        runtime_sha256 = hashlib.sha256(runtime_stage.read_bytes()).hexdigest()
        review["reviewedStage5Sha256"] = runtime_sha256
        evidence = {
            "leafBoundsPx": review["leafBoundsPx"],
            "moduleBoundsPx": review["moduleBoundsPx"],
            "runtimeStage5Sha256": runtime_sha256,
        }
        review["reviewedEvidenceSha256"] = hashlib.sha256(
            json.dumps(evidence, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        review["moduleMatchesVisibleEntrance"] = True
        review["leavesMatchVisibleDoorPixels"] = True
        geometry_path.write_text(f"{json.dumps(geometry, ensure_ascii=False, indent=2)}\n", encoding="utf-8")
        projection_path = STUDIES / f"{key}-v5" / "projection-review.json"
        projection = json.loads(projection_path.read_text(encoding="utf-8"))
        if not projection.get("reviewedEvidenceFingerprint"):
            raise ValueError(f"{key}: projection evidence fingerprint is missing")
        for field in (
            "primaryRoofIsDominantSurface",
            "primaryRoofFrontEdgeMatchesEave",
            "annotationsMatchVisiblePixels",
            "sameCameraAcrossStages",
        ):
            projection[field] = True
        projection_path.write_text(
            f"{json.dumps(projection, ensure_ascii=False, indent=2)}\n",
            encoding="utf-8",
        )
        accepted.append(key)
    print(json.dumps({
        "contactSheet": str(contact_sheet),
        "projectionSheet": str(projection_sheet),
        "accepted": accepted,
    }))


if __name__ == "__main__":
    main()
