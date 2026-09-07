import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import catalog from "../assets/pixel-city-pack/catalog/buildings.json";
import manifest from "../assets/pixel-city-pack/manifest.json";

describe("Pixel City asset Storybook", () => {
  it("rejects substituted courtyard profiles, unknown family members and stretched accepted geometry", () => {
    const stdout = execFileSync(".venv-assets/bin/python", ["-c", `import copy,json,runpy,tempfile,sys
from pathlib import Path
sys.path.insert(0,'scripts')
module=runpy.run_path('scripts/render-pixel-city-storybook.py')
load=module['load_storybook_data']
original=json.loads(module['MANIFEST_PATH'].read_text())
result={}
with tempfile.TemporaryDirectory(prefix='courtyard-storybook-') as directory:
 for case in ('old-profile','unknown-key','wrong-footprint'):
  manifest=copy.deepcopy(original)
  prop=manifest['props']['courtyard-cycle-rack']
  if case=='old-profile': prop['visualProfile']='TASKTOPIA_V6_REPLACED'
  elif case=='unknown-key': manifest['props']['courtyard-unreviewed']=copy.deepcopy(prop)
  else: prop['footprintCells']=[3,1]
  path=Path(directory)/'manifest.json';path.write_text(json.dumps(manifest))
  load.__globals__['MANIFEST_PATH']=path
  result[case]=load()[1]
print(json.dumps(result))`], { encoding: "utf8" });
    const results = JSON.parse(stdout) as Record<string, string[]>;
    for (const [name, errors] of Object.entries(results)) {
      expect(errors.some(error => error.includes(name === "unknown-key" ? "courtyard-unreviewed:" : "courtyard-cycle-rack:")
        && error.includes("accepted visual profile")), name).toBe(true);
    }
  });
  it("covers the complete manifest and validates every runtime canvas", () => {
    const stdout = execFileSync(
      ".venv-assets/bin/python",
      ["scripts/render-pixel-city-storybook.py", "--describe"],
      { encoding: "utf8" },
    );
    const report = JSON.parse(stdout) as {
      variants: string[];
      counts: { buildings: number; stages: number; props: number; vehicles: number; areas: number; terrainFamilies: number };
      errors: string[];
    };

    expect(report.variants).toEqual(["A", "B", "C"]);
    expect(report.counts.buildings).toBe(catalog.buildings.length);
    expect(report.counts.stages).toBe(report.counts.buildings * 5);
    expect(report.counts.props).toBe(Object.keys(manifest.props).length);
    expect(report.counts.vehicles).toBe(15); // Four cars, two people, eight animals and one plane.
    expect(report.counts.areas).toBe(7);
    expect(report.counts.terrainFamilies).toBe(12);
    expect(report.errors).toEqual([]);
  });
});
