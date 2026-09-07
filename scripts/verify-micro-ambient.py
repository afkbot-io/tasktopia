#!/usr/bin/env python3
"""Validate the reviewed native top-down micro family; no gait or size fallback."""
import argparse
import json
from pathlib import Path

from micro_ambient_contract import audit_micro_ambient

ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "assets/pixel-city-pack"
parser = argparse.ArgumentParser()
parser.add_argument("--manifest", type=Path, default=PACK / "manifest.json")
args = parser.parse_args()
manifest = json.loads(args.manifest.read_text())
errors = audit_micro_ambient(manifest, PACK / "runtime", PACK)
print(json.dumps({"valid": not errors, "sprites": len(manifest.get("microAmbient", {}).get("sprites", {})), "errors": errors}))
raise SystemExit(1 if errors else 0)
