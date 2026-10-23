/** Sequential paired workloads. Owns only its child server and explicit free
 * localhost port; never attaches to/kills existing processes or shared data. */
import assert from "node:assert/strict";
import { readFile, mkdir, open, stat, writeFile } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { resolve, join } from "node:path";
import { CITY_SCALE_PROFILES, cityScaleDatabase, type CityScaleFixture, type CityScaleProfile } from "./city-scale-benchmark-contract";

assert.ok(process.env.CITY_SCALE_BUILD_ROOT && process.env.CITY_SCALE_DATABASE_DIRECTORY);
const build = resolve(process.env.CITY_SCALE_BUILD_ROOT);
const directory = resolve(process.env.CITY_SCALE_OUTPUT_ROOT ?? ".builder/world-perf-20261016");
const variant = process.env.CITY_SCALE_VARIANT ?? "baseline";
assert.match(variant, /^[a-zA-Z0-9_-]+$/);
const port = Number(process.env.CITY_SCALE_PORT ?? 5311);
assert.ok(Number.isInteger(port) && port > 5300 && port < 5500 && ![55433, 55434].includes(port));
const profiles = (process.env.CITY_SCALE_PROFILES ?? Object.keys(CITY_SCALE_PROFILES).join(",")).split(",") as CityScaleProfile[];
assert.ok(profiles.length > 0 && profiles.every(profile => Object.hasOwn(CITY_SCALE_PROFILES, profile)));
const sizes = (process.env.CITY_SCALE_SIZES ?? "200,1000").split(",").map(Number);
assert.ok(sizes.length > 0 && sizes.every(count => count === 200 || count === 1000));
await mkdir(directory, { recursive: true });
let server: ChildProcess | undefined;
const stop = async () => {
  if (!server || server.exitCode !== null) return;
  const owned = server;
  await new Promise<void>(resolve => { const timeout = setTimeout(() => owned.kill("SIGKILL"), 10_000);
    owned.once("exit", () => { clearTimeout(timeout); resolve(); }); owned.kill("SIGTERM"); });
  server = undefined;
};
process.on("SIGINT", () => { void stop().then(() => { process.exitCode = 130; }); });
process.on("SIGTERM", () => { void stop().then(() => { process.exitCode = 143; }); });
const completed: { size: number; profile: string; exitCode: number }[] = [];
try {
  for (const count of sizes) {
    // Fails closed when another owner uses the port. Never send it a signal.
    await new Promise<void>((resolve, reject) => { const socket = createServer(); socket.once("error", reject);
      socket.listen(port, "127.0.0.1", () => socket.close(error => error ? reject(error) : resolve())); });
    const fixturePath = join(directory, `fixture-${count}.json`);
    const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as CityScaleFixture;
    const databaseFile = resolve(process.env.CITY_SCALE_DATABASE_DIRECTORY, `world_perf_20261016_${count}-url`);
    assert.equal((await stat(databaseFile)).mode & 0o077, 0, "Database URI must be private (0600)");
    const database = cityScaleDatabase((await readFile(databaseFile, "utf8")).trim(), fixture.tasks).toString();
    const runtimeLog = await open(join(directory, `${variant}-runtime-${count}.log`), "a", 0o600);
    server = spawn(process.execPath, ["dist/server.mjs"], { cwd: build, stdio: ["ignore", runtimeLog.fd, runtimeLog.fd],
      env: { ...process.env, NODE_ENV: "production", HOST: "127.0.0.1", PORT: String(port), APP_ORIGIN: `http://127.0.0.1:${port}`,
        DATABASE_URL: database, RUNTIME_ROLE: "combined", SESSION_COOKIE_SECURE: "false", STATIC_ORIGIN: "", REDIS_URL: "",
        LOG_LEVEL: "warn", AUTH_RATE_LIMIT_MAX: "1000", CITY_SCENE_RATE_LIMIT_MAX: "1000", REGISTRATION_ENABLED: "false",
        UPLOAD_DIR: join(directory, `uploads-${count}`) } });
    try {
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        assert.equal(server.exitCode, null, "Owned benchmark server exited before readiness");
        try { ready = (await fetch(`http://127.0.0.1:${port}/health`)).ok; } catch { /* Wait for own startup. */ }
        if (ready) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.equal(ready, true);
      for (const profile of profiles) {
        const log = await open(join(directory, `${variant}-${count}-${profile}.log`), "w");
        try {
          const child = spawn(process.execPath, ["--import", "tsx", "scripts/measure-city-scale.ts"], { cwd: process.cwd(),
            stdio: ["ignore", log.fd, log.fd], env: { ...process.env, CITY_SCALE_BUILD_ROOT: build,
              CITY_SCALE_FIXTURE: fixturePath, CITY_SCALE_URL: `http://127.0.0.1:${port}`, CITY_SCALE_PROFILE: profile,
              CITY_SCALE_VARIANT: variant, CITY_SCALE_OUTPUT: join(directory, `${variant}-${count}-${profile}`) } });
          const exitCode = await new Promise<number>(resolve => child.once("exit", code => resolve(code ?? 1)));
          completed.push({ size: count, profile, exitCode });
          console.log(JSON.stringify(completed.at(-1)));
          assert.equal(exitCode, 0, `Benchmark ${count}/${profile} failed; retain its log/report before retrying`);
        } finally { await log.close(); }
      }
    } finally { await stop(); await runtimeLog.close(); }
  }
} finally {
  await stop();
  await writeFile(join(directory, `${variant}-runs.json`), JSON.stringify({ build, variant, completed, finishedAt: new Date().toISOString() }, null, 2) + "\n");
}
