"""Shared resolution of the active versioned building-study directory."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping


def active_study_directory(
    building: Mapping[str, Any],
    *,
    reference_root: Path,
    studies_root: Path,
) -> Path:
    """Follow catalog stageSources, falling back to the legacy v5 location."""
    stage_sources = building.get("stageSources", [])
    if not isinstance(stage_sources, list) or not stage_sources:
        return studies_root / f"{building['key']}-v5"
    return reference_root / Path(str(stage_sources[0])).parent.parent
