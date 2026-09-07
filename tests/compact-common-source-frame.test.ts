import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Audit a complete isolated family, never a possibly in-progress runtime pack. */
function auditFrame(change: Record<string, unknown>) {
  return JSON.parse(execFileSync(resolve(".venv-assets/bin/python"), ["-c", `
import json, shutil, sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path('scripts').resolve()))
from compact_asset_contract import audit_compact_family
source_pack = Path('assets/pixel-city-pack')
catalog = json.loads((source_pack / 'catalog/buildings.json').read_text())
authored = next(entry for entry in catalog['buildings'] if entry['key'] == 'compact-wide-v1')
source_family = source_pack / 'reference/ai-authored' / authored['key']
change = json.loads(sys.argv[1])
with tempfile.TemporaryDirectory(prefix='tasktopia-common-frame-audit-') as temporary:
    pack = Path(temporary) / 'pack'
    runtime = Path(temporary) / 'runtime'
    family = pack / 'reference/ai-authored' / authored['key']
    family.mkdir(parents=True)
    entry = {**authored, 'stages': [f'{authored["key"]}/stage-{stage}.png' for stage in range(1, 6)]}
    for name in ('geometry.json', 'report.json', 'visual-review.json'):
        shutil.copyfile(source_family / name, family / name)
    for stage in (3, 4, 5):
        source = pack / 'reference' / authored['stageSources'][stage - 3]
        normalized = family / 'normalized' / f'stage-{stage}.png'
        published = runtime / entry['stages'][stage - 1]
        for target in (source, normalized, published):
            target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source_pack / 'reference' / authored['stageSources'][stage - 3], source)
        shutil.copyfile(source_family / 'normalized' / f'stage-{stage}.png', normalized)
        shutil.copyfile(normalized, published)
    geometry = json.loads((family / 'geometry.json').read_text())
    report = json.loads((family / 'report.json').read_text())
    geometry.pop('commonSourceFrame', None)
    if change.get('declareReportedFrame'):
        geometry['commonSourceFrame'] = list(report['commonSourceFrame'])
    if change.get('moveDeclaredLeft'):
        geometry['commonSourceFrame'][0] -= 1
    for field, record in (('geometryFrame', geometry), ('reportFrame', report)):
        if field in change:
            record['commonSourceFrame'] = change[field]
    if change.get('removeReportFrame'):
        report.pop('commonSourceFrame', None)
    (family / 'geometry.json').write_text(json.dumps(geometry))
    (family / 'report.json').write_text(json.dumps(report))
    print(json.dumps(audit_compact_family(authored, entry, runtime, pack)))
`, JSON.stringify(change)], { encoding: "utf8" })) as string[];
}

describe("published compact common source frame", () => {
  it("keeps the historical optional-frame-free family valid", () => {
    expect(auditFrame({})).toEqual([]);
  });

  it("accepts the exact declared frame recorded by the source verifier", () => {
    expect(auditFrame({ declareReportedFrame: true })).toEqual([]);
  });

  it("rejects a changed declaration even when all PNG hashes and approvals still match", () => {
    expect(auditFrame({ declareReportedFrame: true, moveDeclaredLeft: true }))
      .toEqual(expect.arrayContaining([expect.stringContaining("commonSourceFrame")]));
  });

  it.each([
    ["missing", { removeReportFrame: true }],
    ["null", { reportFrame: null }],
  ])("rejects a %s report frame for an explicit geometry declaration", (_label, change) => {
    expect(auditFrame({ declareReportedFrame: true, ...change }))
      .toEqual(expect.arrayContaining([expect.stringContaining("commonSourceFrame")]));
  });

  it.each([
    ["null", null, null],
    ["per-stage map", { "5": [244, 148, 1291, 875] }, { "5": [244, 148, 1291, 875] }],
    ["boolean equal to integer", [true, 148, 1291, 875], [1, 148, 1291, 875]],
    ["unsafe integer", [0, 0, 9007199254740992, 875], [0, 0, 9007199254740992, 875]],
    ["negative origin", [-1, 148, 1291, 875], [-1, 148, 1291, 875]],
    ["empty rectangle", [244, 148, 244, 875], [244, 148, 244, 875]],
    ["reversed rectangle", [1291, 875, 244, 148], [1291, 875, 244, 148]],
    ["outside source canvas", [244, 148, 1537, 875], [244, 148, 1537, 875]],
  ])("rejects malformed %s declarations rather than accepting Python equality", (_label, geometryFrame, reportFrame) => {
    expect(auditFrame({ geometryFrame, reportFrame }))
      .toEqual(expect.arrayContaining([expect.stringContaining("commonSourceFrame")]));
  });
});
