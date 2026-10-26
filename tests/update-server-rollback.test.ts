import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

type State = { events: string[]; tags: Record<string, string>; images: Record<string, string>; oldAvailable: boolean };
function runUpdater(options: { failPin?: boolean; wrongPin?: boolean; failRestoreTag?: boolean; wrongRole?: boolean; failRestoreHealth?: boolean } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "tasktopia-image-rollback-")));
  const app = join(root, "app"), bin = join(root, "bin"), staticDir = join(root, "static");
  const statePath = join(root, "state.json"), head = "2".repeat(40);
  const executable = (name: string, code: string) => {
    const path = join(bin, name); writeFileSync(path, `#!${process.execPath}\n${code}\n`); chmodSync(path, 0o755);
  };
  try {
    mkdirSync(join(app, "deploy"), { recursive: true }); mkdirSync(bin);
    mkdirSync(join(staticDir, "releases", "previous"), { recursive: true });
    symlinkSync(join(staticDir, "releases", "previous"), join(staticDir, "current"));
    writeFileSync(join(app, "deploy", "update-server.sh"), readFileSync(new URL("../deploy/update-server.sh", import.meta.url)));
    // Schema/static preparation is outside this image-lifecycle scenario.
    writeFileSync(join(app, "deploy", "compact-release-preflight.sh"), "check_compact_release_database(){ :; }\ncheck_compact_rollback_image(){ :; }\n");
    writeFileSync(join(app, "deploy", "static-release.sh"), "prepare_static_release_paths(){ :; }\npreserve_failed_prepublished_generation(){ :; }\nrollback_prepublished_paths(){ :; }\n");
    writeFileSync(join(app, "deploy", "public-release-smoke.py"), "raise SystemExit('Injected public smoke failure')\n");
    writeFileSync(statePath, JSON.stringify({ events: [], tags: { "app-app:latest": "sha256:old" },
      images: { app: "sha256:old", mcp: "sha256:old", world: "sha256:old" }, oldAvailable: true } satisfies State));
    executable("git", `if(process.argv[2]==='pull')process.exit(0);if(process.argv[2]==='rev-parse'){console.log(process.argv.includes('--short')?'22222222':'${head}');process.exit(0);}process.exit(2);`);
    executable("flock", "process.exit(0);");
    executable("curl", String.raw`const fs=require('node:fs'),s=JSON.parse(fs.readFileSync(process.env.FAKE_DOCKER_STATE,'utf8')),opt=JSON.parse(process.env.FAKE_DOCKER_OPTIONS);
if(opt.failRestoreHealth&&s.events.some(e=>e.includes('compose up')&&e.includes('--force-recreate'))&&process.argv.at(-1).endsWith(':3000/health'))process.exit(22);
console.log('{"status":"ok","version":"1.25.0"}');`);
    // The production updater is Linux-only; emulate GNU mv's atomic -T rename
    // on macOS while confining every filesystem operation to this fixture.
    executable("mv", String.raw`const fs=require('node:fs'),path=require('node:path');
const root=path.dirname(process.env.FAKE_DOCKER_STATE),args=process.argv.slice(2).filter(a=>!['-Tf','-f','--'].includes(a));
if(args.length!==2||args.some(a=>!a.startsWith(root+path.sep)))process.exit(2);
fs.renameSync(args[0],args[1]);`);
    executable("docker", String.raw`
const fs=require('node:fs'),path=require('node:path'),a=process.argv.slice(2),file=process.env.FAKE_DOCKER_STATE;
const s=JSON.parse(fs.readFileSync(file,'utf8')),opt=JSON.parse(process.env.FAKE_DOCKER_OPTIONS);
s.events.push(a.join(' '));
const save=()=>fs.writeFileSync(file,JSON.stringify(s));
const done=(value='')=>{save();if(value)console.log(value);process.exit(0);};
const fail=message=>{save();console.error(message);process.exit(1);};
const image=ref=>ref==='sha256:old'?(s.oldAvailable?'sha256:old':null):ref==='sha256:new'?ref:s.tags[ref];
if(a[0]==='compose'&&a[1]==='ps'){if(a.includes('--status'))done();if(a.includes('-q'))done(a.at(-1)+'-container');done();}
if(a[0]==='compose'&&a[1]==='config')done(JSON.stringify({services:{app:{image:'app-app:latest',environment:{APP_ORIGIN:'https://fixture.invalid'}}}}));
if(a[0]==='inspect'){
 const role=a.at(-1).replace('-container',''),format=a[a.indexOf('--format')+1];
 if(format==='{{.Image}}')done(s.images[role]);
 if(format==='{{.State.Running}}')done('true');
 if(format==='{{.Image}} {{.State.Running}}')done(s.images[role]+' true');
}
if(a[0]==='image'&&a[1]==='inspect'){const id=image(a.at(-1));if(id)done(id);fail('No such image');}
if(a[0]==='tag'){
 const source=a[1],dest=a[2];
 if(opt.failPin&&dest!=='app-app:latest')fail('Injected pin failure');
 if(opt.failRestoreTag&&dest==='app-app:latest')fail('Injected restore tag failure');
 const id=image(source);if(!id)fail('No such image: '+source);s.tags[dest]=opt.wrongPin&&dest!=='app-app:latest'?'sha256:new':id;done();
}
if(a[0]==='compose'&&a[1]==='build'){
 s.tags['app-app:latest']='sha256:new';
 // Old containers can keep running although the unpinned image no longer resolves.
 s.oldAvailable=Object.entries(s.tags).some(([ref,id])=>ref!=='app-app:latest'&&id==='sha256:old');done();
}
if(a[0]==='compose'&&a[1]==='up'){
 for(const role of ['app','mcp','world'])s.images[role]=opt.wrongRole&&a.includes('--force-recreate')&&role==='mcp'?'sha256:new':s.tags['app-app:latest'];done();
}
if(a[0]==='create')done('export-container');
if(a[0]==='start')done('0123456789abcdef');
if(a[0]==='cp'){fs.mkdirSync(a.at(-1),{recursive:true});fs.writeFileSync(path.join(a.at(-1),'index.html'),'candidate');done();}
if(a[0]==='rm')done();
fail('Unexpected fake Docker command: '+a.join(' '));
`);
    const result = spawnSync("bash", [join(app, "deploy", "update-server.sh")], {
      encoding: "utf8", timeout: 10_000,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, TASKTOPIA_APP_DIR: app,
        TASKTOPIA_STATIC_DIR: staticDir, TASKTOPIA_EXPECTED_REVISION: head, HEALTH_RETRY_COUNT: "1",
        FAKE_DOCKER_STATE: statePath, FAKE_DOCKER_OPTIONS: JSON.stringify(options) },
    });
    const current = readlinkSync(join(staticDir, "current")), entries = readdirSync(join(staticDir, "releases"));
    return { result, state: JSON.parse(readFileSync(statePath, "utf8")) as State,
      staticState: { current, currentExists: existsSync(current), previous: join(staticDir, "releases", "previous"),
        candidates: entries.filter(name => !name.startsWith(".") && name !== "previous"),
        journals: entries.filter(name => name.startsWith(".prepublished-")) } };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

it("restores the previous image after smoke fails even when healthy new containers use the overwritten tag", () => {
  const { result, state, staticState } = runUpdater();
  expect(result.status, result.stderr).toBe(1);
  expect(result.stderr).toContain("Injected public smoke failure");
  expect(state.images).toEqual({ app: "sha256:old", mcp: "sha256:old", world: "sha256:old" });
  expect(result.stderr).toContain("Rollback restored and verified previous image for app/mcp/world");
  expect(staticState.current).toBe(staticState.previous);
  expect(staticState.candidates).toEqual([]);
  expect(staticState.journals).toEqual([]);
});

it.each([{ failPin: true }, { wrongPin: true }])("refuses to build without an exact previous image pin (%j)", options => {
  const { result, state } = runUpdater(options);
  expect(result.status).not.toBe(0);
  expect(state.events.some(event => event.startsWith("compose build"))).toBe(false);
  expect(state.images).toEqual({ app: "sha256:old", mcp: "sha256:old", world: "sha256:old" });
});

it("does not recreate healthy candidate containers when restoring the configured image tag fails", () => {
  const { result, state, staticState } = runUpdater({ failRestoreTag: true });
  expect(result.status).toBe(1);
  expect(state.events.filter(event => event.startsWith("compose up"))).toHaveLength(1);
  expect(result.stderr).toContain("Rollback failed: previous image restoration was not verified");
  expect(result.stderr).not.toContain("Rollback restored and verified");
  expect(staticState.current).not.toBe(staticState.previous);
  expect(staticState.currentExists).toBe(true);
  expect(staticState.candidates).toHaveLength(1);
  expect(staticState.journals).toHaveLength(1);
});

it("rejects rollback when health is green but one role still uses the candidate image", () => {
  const { result, state, staticState } = runUpdater({ wrongRole: true });
  expect(result.status).toBe(1);
  expect(state.images.mcp).toBe("sha256:new");
  expect(result.stderr).toContain("Previous image identity/running state mismatch for mcp");
  expect(result.stderr).toContain("Rollback failed: previous image restoration was not verified");
  expect(result.stderr).not.toContain("Rollback restored and verified");
  expect(staticState.current).not.toBe(staticState.previous);
  expect(staticState.currentExists).toBe(true);
  expect(staticState.candidates).toHaveLength(1);
  expect(staticState.journals).toHaveLength(1);
});

it("fails rollback when the first role health fails even if later roles would respond healthy", () => {
  const { result, staticState } = runUpdater({ failRestoreHealth: true });
  expect(result.status).toBe(1);
  expect(result.stderr).not.toContain("Rollback restored and verified");
  expect(result.stderr).toContain("Rollback failed: previous image restoration was not verified");
  expect(staticState.current).not.toBe(staticState.previous);
  expect(staticState.currentExists).toBe(true);
  expect(staticState.candidates).toHaveLength(1);
  expect(staticState.journals).toHaveLength(1);
});
