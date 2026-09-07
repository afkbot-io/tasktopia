"""Import built-in ImageGen outputs as UNREVIEWED compact authoring candidates.

Never adds families to the runtime catalog or fabricates visual approvals.
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
authoring = root / "assets/pixel-city-pack/reference/ai-authored"
base = json.loads((authoring / "compact-apartment-v1/geometry.json").read_text())
for source in sorted((root / "tmp/new-building-art").glob("*-stage5.png")):
    key = source.stem.removesuffix("-stage5")
    family = authoring / key
    if (family / "visual-review.json").exists():
        raise SystemExit(f"Refusing to overwrite reviewed family: {key}")
    (family / "sources").mkdir(parents=True, exist_ok=True)
    contract = {**base, "key": key, "sourceBackground": "magenta-recovery",
                "authoringStatus": "DRAFT_NOT_APPROVED", "stages": {**base["stages"], "5": f"Finished {key}; awaiting individual projection review."}}
    (family / "geometry.json").write_text(json.dumps(contract, indent=2) + "\n")
    for stage in [5, 4, 3]:
        candidate = source.parent / f"{key}-stage{stage}.png"
        if candidate.exists():
            shutil.copyfile(candidate, family / "sources" / f"stage-{stage}.png")
    result = subprocess.run([sys.executable, str(root / "scripts/verify-compact-building-art.py"), "--family", str(family)], capture_output=True, text=True)
    report = json.loads((family / "report.json").read_text())
    print(key, result.returncode, report["stages"].get("5", {}).get("occupiedSizePx"), report["errors"])
