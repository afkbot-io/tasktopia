import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("production reverse proxy", () => {
  const nginx = readFileSync(new URL("../deploy/nginx-tasktopia.conf", import.meta.url), "utf8");
  const compose = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");
  const developmentCompose = readFileSync(new URL("../docker-compose.dev.yml", import.meta.url), "utf8");
  const developmentEnv = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
  const selfHostEnv = readFileSync(new URL("../deploy/.env.self-host.example", import.meta.url), "utf8");
  const playwright = readFileSync(new URL("../playwright.config.ts", import.meta.url), "utf8");
  const viteConfig = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
  const clientMain = readFileSync(new URL("../src/client/main.tsx", import.meta.url), "utf8");
  const serverConfig = readFileSync(new URL("../src/server/config.ts", import.meta.url), "utf8");
  const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  const dockerignore = readFileSync(new URL("../.dockerignore", import.meta.url), "utf8");
  const updateScript = readFileSync(new URL("../deploy/update-server.sh", import.meta.url), "utf8");
  const installScript = readFileSync(new URL("../deploy/install-server.sh", import.meta.url), "utf8");
  const staticReleaseScript = new URL("../deploy/static-release.sh", import.meta.url).pathname;
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    scripts: Record<string, string>;
  };

  it("keeps full country regeneration alive beyond the ordinary API timeout", () => {
    const location = nginx.match(/location ~ \^\/api\/countries\/\[0-9a-f-\]\+\/regenerate\$ \{([\s\S]*?)\n\s*\}/)?.[1];
    expect(location, "dedicated country regeneration location").toBeDefined();

    const readTimeout = Number(location!.match(/proxy_read_timeout\s+(\d+)s;/)?.[1]);
    const sendTimeout = Number(location!.match(/proxy_send_timeout\s+(\d+)s;/)?.[1]);
    expect(readTimeout).toBeGreaterThanOrEqual(900);
    expect(sendTimeout).toBeGreaterThanOrEqual(900);
    expect(location).toContain("proxy_buffering off;");
  });

  it("ships a domain-neutral self-host configuration and a valid installer", () => {
    const bootstrap = readFileSync(new URL("../deploy/nginx-self-host-bootstrap.conf.template", import.meta.url), "utf8");
    const tls = readFileSync(new URL("../deploy/nginx-self-host.conf.template", import.meta.url), "utf8");
    const legacyTls = readFileSync(new URL("../deploy/nginx-self-host-legacy-proxy.conf.template", import.meta.url), "utf8");
    expect(bootstrap).toContain("server_name __DOMAIN__;");
    expect(tls).toContain("/etc/letsencrypt/live/__DOMAIN__/fullchain.pem");
    expect(bootstrap).toContain("root __STATIC_DIR__/current;");
    expect(tls).toContain("root __STATIC_DIR__/current;");
    expect(bootstrap.match(/location ~\* \^\/\(game-assets\|assets\)\/ \{([\s\S]*?)\n\s*\}/)?.[1]).not.toContain("proxy_pass");
    expect(tls.match(/location ~\* \^\/\(game-assets\|assets\)\/ \{([\s\S]*?)\n\s*\}/)?.[1]).not.toContain("proxy_pass");
    expect(installScript).toContain('s|__STATIC_DIR__|$static_dir|g');
    expect(updateScript).toContain("refresh_self_host_nginx_static_config");
    expect(updateScript).toContain("is_managed_self_host_nginx_config");
    expect(updateScript).toContain("persisted_static_dir=");
    expect(installScript).toContain("TASKTOPIA_STATIC_DIR=%s");
    expect(installScript.indexOf("refusing an unsafe installer rerun")).toBeLessThan(installScript.indexOf("apt-get update"));
    expect(installScript.indexOf("refusing an unsafe installer rerun")).toBeLessThan(installScript.indexOf("docker compose up -d --build"));
    expect(installScript).not.toContain('git -C "$app_dir" fetch');
    const renderedTls = tls
      .replaceAll("__DOMAIN__", "tasks.example.com")
      .replaceAll("__STATIC_DIR__", "/srv/example/static");
    expect(renderedTls).toContain("root /srv/example/static/current;");
    expect(renderedTls).not.toContain("__STATIC_DIR__");
    expect(legacyTls).not.toContain("Managed by Tasktopia");
    expect(bootstrap).not.toContain("tasktopia.online");
    expect(tls).not.toContain("tasktopia.online");
    expect(() => execFileSync("bash", ["-n", new URL("../deploy/install-server.sh", import.meta.url).pathname])).not.toThrow();
    expect(() => execFileSync("bash", ["-n", new URL("../deploy/update-server.sh", import.meta.url).pathname])).not.toThrow();
    expect(() => execFileSync("bash", ["-n", new URL("../deploy/static-release.sh", import.meta.url).pathname])).not.toThrow();
  });

  it("migrates only owned or exact legacy self-host nginx sites", () => {
    const root = mkdtempSync(join(tmpdir(), "tasktopia-nginx-ownership-"));
    const managed = join(root, "managed.conf");
    const legacy = join(root, "legacy.conf");
    const customized = join(root, "customized.conf");
    const renderedLegacy = readFileSync(new URL("../deploy/nginx-self-host-legacy-proxy.conf.template", import.meta.url), "utf8")
      .replaceAll("__DOMAIN__", "tasks.example.com");

    try {
      writeFileSync(managed, "# Managed by Tasktopia's self-host installer and update script.\ncustom body\n");
      writeFileSync(legacy, renderedLegacy);
      writeFileSync(customized, `${renderedLegacy}\n# operator WAF customization\n`);

      expect(() => execFileSync("bash", ["-c", 'source "$1"; is_managed_self_host_nginx_config "$2" "$3"', "bash", staticReleaseScript, managed, legacy])).not.toThrow();
      expect(() => execFileSync("bash", ["-c", 'source "$1"; is_managed_self_host_nginx_config "$2" "$3"', "bash", staticReleaseScript, legacy, legacy])).not.toThrow();
      expect(() => execFileSync("bash", ["-c", 'source "$1"; is_managed_self_host_nginx_config "$2" "$3"', "bash", staticReleaseScript, customized, legacy], { stdio: "ignore" })).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses the real browser origin and keeps the application bound to loopback by default", () => {
    expect(compose).toContain("image: ${APP_IMAGE:-${COMPOSE_PROJECT_NAME:-tasktopia}-app:latest}");
    expect(compose).toContain("APP_ORIGIN: ${APP_ORIGIN:-http://localhost:3000}");
    expect(compose).toContain("${APP_BIND_ADDRESS:-127.0.0.1}:${APP_PORT:-3000}:3000");
  });

  it("fails closed for public registration in production while keeping development explicit", () => {
    expect(compose).toContain("REGISTRATION_ENABLED: ${REGISTRATION_ENABLED:-false}");
    expect(dockerfile).toContain("REGISTRATION_ENABLED=false");
    expect(selfHostEnv).toContain("REGISTRATION_ENABLED=false");
    expect(developmentEnv).toContain("REGISTRATION_ENABLED=true");
    expect(serverConfig).toContain('raw.NODE_ENV !== "production"');
    expect(playwright).toContain('REGISTRATION_ENABLED: "true"');
  });

  it("ships the controlled user-creation command in the production bundle", () => {
    expect(packageJson.scripts["user:create"]).toBe("node dist/create-user.mjs");
    expect(packageJson.scripts.build).toContain("src/server/create-user-cli.ts");
    expect(packageJson.scripts.build).toContain("dist/create-user.mjs");
  });

  it("ships the static-export asset synchronizer in the production bundle", () => {
    expect(packageJson.scripts.build).toContain("src/server/synchronize-assets-cli.ts");
    expect(packageJson.scripts.build).toContain("dist/synchronize-assets.mjs");
  });

  it("uses one CDN origin for the browser build and runtime policy", () => {
    expect(compose).toContain("STATIC_ORIGIN: ${STATIC_ORIGIN:-}");
    expect(compose).not.toContain("VITE_STATIC_ORIGIN:");
    expect(dockerfile).toContain("ARG STATIC_ORIGIN");
    expect(dockerfile).toContain("ENV VITE_STATIC_ORIGIN=${STATIC_ORIGIN}");
  });

  it("content-addresses the browser entry by application release", () => {
    expect(viteConfig).toContain("__TASKTOPIA_VERSION__");
    expect(viteConfig).toContain("package.json");
    expect(clientMain).toContain("document.documentElement.dataset.appVersion = __TASKTOPIA_VERSION__");
  });

  it("persists several immutable asset revisions across application updates", () => {
    expect(compose).toContain("tasktopia_asset_revisions:/app/dist/public/game-assets/v5/revisions");
    expect(compose).toMatch(/tasktopia_asset_revisions:\s*$/mu);
  });

  it("keeps source art outside the production Docker context", () => {
    expect(dockerignore).toContain("assets/*");
    expect(dockerignore).toContain("!assets/pixel-city-pack/manifest.json");
    expect(dockerignore).toContain("!assets/pixel-city-pack/catalog/**");
    expect(dockerignore).not.toContain("!assets/pixel-city-pack/reference");
    expect(dockerignore).not.toContain("!assets/pixel-city-pack/runtime");
  });

  it("guards disk space and rotates pre-update database backups", () => {
    expect(updateScript).toContain('BACKUP_RETENTION_COUNT="${BACKUP_RETENTION_COUNT:-14}"');
    expect(updateScript).toContain('MIN_FREE_SPACE_MB="${MIN_FREE_SPACE_MB:-1024}"');
    expect(updateScript).toContain("stale_count=");
  });

  it("publishes new immutable assets before the application can reference them", () => {
    const lockIndex = updateScript.indexOf('flock -n "$update_lock_fd"');
    const pullIndex = updateScript.indexOf('git pull --ff-only origin "$BRANCH"');
    const reexecIndex = updateScript.indexOf('exec env TASKTOPIA_UPDATE_REEXEC="$checkout_head_after_pull"');
    const backupIndex = updateScript.indexOf("docker compose exec -T postgres pg_dump");
    const exportIndex = updateScript.indexOf("docker create --name");
    const prepublishIndex = updateScript.indexOf("prepare_static_release_paths");
    const applicationSwitchIndex = updateScript.indexOf("docker compose up -d --remove-orphans app");
    const staticSwitchIndex = updateScript.lastIndexOf('mv -Tf -- "$static_next_link" "$STATIC_DIR/current"');
    const sourceIndex = updateScript.indexOf('source "$APP_DIR/deploy/static-release.sh"');

    expect(lockIndex).toBeGreaterThan(-1);
    expect(pullIndex).toBeGreaterThan(lockIndex);
    expect(sourceIndex).toBeGreaterThan(pullIndex);
    expect(reexecIndex).toBeGreaterThan(pullIndex);
    expect(backupIndex).toBeGreaterThan(reexecIndex);
    expect(exportIndex).toBeGreaterThan(-1);
    expect(prepublishIndex).toBeGreaterThan(exportIndex);
    expect(applicationSwitchIndex).toBeGreaterThan(prepublishIndex);
    expect(staticSwitchIndex).toBeGreaterThan(applicationSwitchIndex);
    expect(updateScript).toContain("bootstrap_static_release_from_container");
    expect(installScript).toContain("bootstrap_static_release_from_container");
    expect(updateScript).toContain('rollback_prepublished_paths "$prepublish_journal"');
    expect(updateScript.indexOf("preserve_failed_prepublished_generation")).toBeGreaterThan(
      updateScript.indexOf('docker tag "$previous_app_image_id" "$app_image_ref"'),
    );
    expect(updateScript).toContain('docker tag "$previous_app_image_id" "$app_image_ref"');
    expect(updateScript).toContain("docker compose up -d --remove-orphans --force-recreate app");
  });

  it("executes the freshly pulled updater before taking a backup", () => {
    const root = mkdtempSync(join(tmpdir(), "tasktopia-updater-reexec-"));
    const app = join(root, "app");
    const bin = join(root, "bin");
    const state = join(root, "head");
    const replacement = join(root, "replacement.sh");
    const marker = join(root, "marker");
    const updater = join(app, "deploy/update-server.sh");
    const oldHead = "1111111111111111111111111111111111111111";
    const newHead = "2222222222222222222222222222222222222222";

    try {
      mkdirSync(join(app, "deploy"), { recursive: true });
      mkdirSync(bin, { recursive: true });
      writeFileSync(updater, updateScript);
      writeFileSync(state, oldHead);
      writeFileSync(replacement, `#!/usr/bin/env bash\nprintf '%s' "\${TASKTOPIA_UPDATE_REEXEC:-}" > "\${FAKE_UPDATE_MARKER}"\n`);
      writeFileSync(join(bin, "git"), `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "rev-parse" && "$2" == "HEAD" ]]; then
  cat "$FAKE_GIT_STATE"
elif [[ "$1" == "pull" && "$2" == "--ff-only" ]]; then
  cp "$FAKE_UPDATE_REPLACEMENT" "$TASKTOPIA_APP_DIR/deploy/update-server.sh.next"
  chmod 0755 "$TASKTOPIA_APP_DIR/deploy/update-server.sh.next"
  mv "$TASKTOPIA_APP_DIR/deploy/update-server.sh.next" "$TASKTOPIA_APP_DIR/deploy/update-server.sh"
  printf '%s' "$FAKE_GIT_NEW_HEAD" > "$FAKE_GIT_STATE"
else
  echo "Unexpected git invocation: $*" >&2
  exit 2
fi
`);
      writeFileSync(join(bin, "flock"), "#!/usr/bin/env bash\nexit 0\n");
      chmodSync(updater, 0o755);
      chmodSync(replacement, 0o755);
      chmodSync(join(bin, "git"), 0o755);
      chmodSync(join(bin, "flock"), 0o755);

      execFileSync("bash", [updater], {
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          TASKTOPIA_APP_DIR: app,
          TASKTOPIA_BRANCH: "main",
          TASKTOPIA_UPDATE_LOCK_PATH: join(root, "update.lock"),
          FAKE_GIT_STATE: state,
          FAKE_GIT_NEW_HEAD: newHead,
          FAKE_UPDATE_REPLACEMENT: replacement,
          FAKE_UPDATE_MARKER: marker,
        },
      });

      expect(readFileSync(marker, "utf8")).toBe(newHead);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a concurrent updater before repository or Docker mutations", async () => {
    const root = mkdtempSync(join(tmpdir(), "tasktopia-updater-lock-"));
    const app = join(root, "app");
    const bin = join(root, "bin");
    const state = join(root, "head");
    const started = join(root, "started");
    const release = join(root, "release");
    const calls = join(root, "git-calls");
    const replacement = join(root, "replacement.sh");
    const marker = join(root, "marker");
    const updater = join(app, "deploy/update-server.sh");
    const oldHead = "1111111111111111111111111111111111111111";
    const newHead = "2222222222222222222222222222222222222222";

    try {
      mkdirSync(join(app, "deploy"), { recursive: true });
      mkdirSync(bin, { recursive: true });
      writeFileSync(updater, updateScript);
      writeFileSync(state, oldHead);
      writeFileSync(replacement, `#!/usr/bin/env bash\nprintf done > "\${FAKE_UPDATE_MARKER}"\n`);
      writeFileSync(join(bin, "git"), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$FAKE_GIT_CALLS"
if [[ "$1" == "rev-parse" && "$2" == "HEAD" ]]; then
  if [[ ! -e "$FAKE_GIT_STARTED" ]]; then
    : > "$FAKE_GIT_STARTED"
    while [[ ! -e "$FAKE_GIT_RELEASE" ]]; do sleep 0.05; done
  fi
  cat "$FAKE_GIT_STATE"
elif [[ "$1" == "pull" && "$2" == "--ff-only" ]]; then
  cp "$FAKE_UPDATE_REPLACEMENT" "$TASKTOPIA_APP_DIR/deploy/update-server.sh.next"
  chmod 0755 "$TASKTOPIA_APP_DIR/deploy/update-server.sh.next"
  mv "$TASKTOPIA_APP_DIR/deploy/update-server.sh.next" "$TASKTOPIA_APP_DIR/deploy/update-server.sh"
  printf '%s' "$FAKE_GIT_NEW_HEAD" > "$FAKE_GIT_STATE"
else
  exit 2
fi
`);
      writeFileSync(join(bin, "flock"), `#!/usr/bin/env bash
mkdir "$FAKE_FLOCK_DIR" 2>/dev/null
`);
      chmodSync(updater, 0o755);
      chmodSync(replacement, 0o755);
      chmodSync(join(bin, "git"), 0o755);
      chmodSync(join(bin, "flock"), 0o755);
      const env = {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        TASKTOPIA_APP_DIR: app,
        TASKTOPIA_BRANCH: "main",
        TASKTOPIA_UPDATE_LOCK_PATH: join(root, "update.lock"),
        FAKE_GIT_STATE: state,
        FAKE_GIT_NEW_HEAD: newHead,
        FAKE_GIT_STARTED: started,
        FAKE_GIT_RELEASE: release,
        FAKE_GIT_CALLS: calls,
        FAKE_FLOCK_DIR: join(root, "held-lock"),
        FAKE_UPDATE_REPLACEMENT: replacement,
        FAKE_UPDATE_MARKER: marker,
      };
      const first = spawn("bash", [updater], { env });
      const deadline = Date.now() + 3_000;
      while (!existsSync(started) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(existsSync(started)).toBe(true);

      const second = spawnSync("bash", [updater], { env, encoding: "utf8" });
      expect(second.status).toBe(1);
      expect(second.stderr).toContain("Another Tasktopia update is already running");
      expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(1);

      writeFileSync(release, "go");
      const firstStatus = await new Promise<number | null>((resolve) => first.once("close", resolve));
      expect(firstStatus).toBe(0);
      expect(readFileSync(marker, "utf8")).toBe("done");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("prepublishes the new image revision and retains the previous revision", () => {
    const root = mkdtempSync(join(tmpdir(), "tasktopia-static-release-"));
    const currentRevision = "bbbbbbbbbbbbbbbb";
    const previousRevision = "aaaaaaaaaaaaaaaa";
    const incoming = join(root, "incoming");
    const active = join(root, "active");
    const journal = join(root, "prepublished.files");
    const staticScript = new URL("../deploy/static-release.sh", import.meta.url).pathname;

    try {
      mkdirSync(join(incoming, "assets"), { recursive: true });
      mkdirSync(join(incoming, `game-assets/v5/revisions/${currentRevision}`), { recursive: true });
      mkdirSync(join(active, "assets"), { recursive: true });
      for (const [index, revision] of [previousRevision, "cccccccccccccccc", "dddddddddddddddd", "eeeeeeeeeeeeeeee"].entries()) {
        const revisionPath = join(active, `game-assets/v5/revisions/${revision}`);
        mkdirSync(revisionPath, { recursive: true });
        writeFileSync(join(revisionPath, "tile.png"), revision);
        utimesSync(revisionPath, index + 1, index + 1);
      }
      mkdirSync(join(active, "game-assets/v5"), { recursive: true });
      writeFileSync(join(active, "game-assets/v5/manifest.json"), JSON.stringify({ assetRevision: previousRevision }));
      writeFileSync(join(incoming, "assets/new-bundle.js"), "new bundle");
      writeFileSync(join(incoming, "assets/existing-bundle.js"), "existing immutable bytes");
      writeFileSync(join(incoming, `game-assets/v5/revisions/${currentRevision}/tile.png`), "revision b");
      writeFileSync(join(active, "assets/existing-bundle.js"), "existing immutable bytes");
      writeFileSync(join(active, "assets/old-lazy-bundle.js"), "old lazy bundle");

      execFileSync("bash", ["-c", 'source "$1"; prepare_static_release_paths "$2" "$3" "$4" 3 "$5"', "bash", staticScript, incoming, active, currentRevision, journal]);

      expect(readFileSync(join(active, "assets/new-bundle.js"), "utf8")).toBe("new bundle");
      expect(readFileSync(join(active, "assets/existing-bundle.js"), "utf8")).toBe("existing immutable bytes");
      expect(readFileSync(join(incoming, "assets/old-lazy-bundle.js"), "utf8")).toBe("old lazy bundle");
      expect(readFileSync(join(incoming, ".tasktopia/current-assets.list"), "utf8").trim().split("\n")).toEqual([
        "existing-bundle.js",
        "new-bundle.js",
      ]);
      expect(readFileSync(join(active, `game-assets/v5/revisions/${currentRevision}/tile.png`), "utf8")).toBe("revision b");
      expect(readFileSync(join(incoming, `game-assets/v5/revisions/${previousRevision}/tile.png`), "utf8")).toBe(previousRevision);
      expect(readdirSync(join(incoming, "game-assets/v5/revisions")).sort()).toEqual([
        previousRevision,
        currentRevision,
        "eeeeeeeeeeeeeeee",
      ]);
      expect(readFileSync(journal).toString().split("\0").filter(Boolean).sort()).toEqual([
        join(active, "assets/new-bundle.js"),
        join(active, `game-assets/v5/revisions/${currentRevision}/tile.png`),
      ].sort());

      execFileSync("bash", ["-c", 'source "$1"; rollback_prepublished_paths "$2" "$3"', "bash", staticScript, journal, active]);
      expect(existsSync(join(active, "assets/new-bundle.js"))).toBe(false);
      expect(existsSync(join(active, `game-assets/v5/revisions/${currentRevision}`))).toBe(false);
      expect(readFileSync(join(active, "assets/existing-bundle.js"), "utf8")).toBe("existing immutable bytes");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("retains only the active asset generation after legacy migration", () => {
    const root = mkdtempSync(join(tmpdir(), "tasktopia-asset-generation-"));
    const currentRevision = "bbbbbbbbbbbbbbbb";
    const previousRevision = "aaaaaaaaaaaaaaaa";
    const incoming = join(root, "incoming");
    const active = join(root, "active");
    const staticScript = new URL("../deploy/static-release.sh", import.meta.url).pathname;

    try {
      mkdirSync(join(incoming, "assets"), { recursive: true });
      mkdirSync(join(incoming, `game-assets/v5/revisions/${currentRevision}`), { recursive: true });
      mkdirSync(join(active, "assets"), { recursive: true });
      mkdirSync(join(active, ".tasktopia"), { recursive: true });
      mkdirSync(join(active, `game-assets/v5/revisions/${previousRevision}`), { recursive: true });
      writeFileSync(join(incoming, "assets/new.js"), "new");
      writeFileSync(join(incoming, `game-assets/v5/revisions/${currentRevision}/tile.png`), "current");
      writeFileSync(join(active, "assets/current-old.js"), "current old");
      writeFileSync(join(active, "assets/stale-old.js"), "stale old");
      writeFileSync(join(active, ".tasktopia/current-assets.list"), "current-old.js\n");
      writeFileSync(join(active, `game-assets/v5/revisions/${previousRevision}/tile.png`), "previous");
      mkdirSync(join(active, "game-assets/v5"), { recursive: true });
      writeFileSync(join(active, "game-assets/v5/manifest.json"), JSON.stringify({ assetRevision: previousRevision }));

      execFileSync("bash", ["-c", 'source "$1"; prepare_static_release_paths "$2" "$3" "$4"', "bash", staticScript, incoming, active, currentRevision]);

      expect(readFileSync(join(incoming, "assets/current-old.js"), "utf8")).toBe("current old");
      expect(existsSync(join(incoming, "assets/stale-old.js"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps failed immutable generations available with a hard retention bound", () => {
    const root = mkdtempSync(join(tmpdir(), "tasktopia-failed-assets-"));
    const active = join(root, "active");
    const staticScript = new URL("../deploy/static-release.sh", import.meta.url).pathname;
    const currentRevision = "aaaaaaaaaaaaaaaa";
    const previousRevision = "bbbbbbbbbbbbbbbb";

    try {
      mkdirSync(join(active, "assets"), { recursive: true });
      mkdirSync(join(active, `game-assets/v5/revisions/${currentRevision}`), { recursive: true });
      mkdirSync(join(active, `game-assets/v5/revisions/${previousRevision}`), { recursive: true });
      mkdirSync(join(active, "game-assets/v5"), { recursive: true });
      mkdirSync(join(active, ".tasktopia"), { recursive: true });
      writeFileSync(join(active, "game-assets/v5/manifest.json"), JSON.stringify({ assetRevision: currentRevision }));
      writeFileSync(join(active, ".tasktopia/previous-asset-revision"), `${previousRevision}\n`);
      writeFileSync(join(active, ".tasktopia/current-assets.list"), "current.js\n");
      writeFileSync(join(active, "assets/current.js"), "current");

      for (let index = 1; index <= 4; index += 1) {
        const source = join(root, `source-${index}`);
        const revisionSource = join(root, `revision-source-${index}`);
        const journal = join(root, `journal-${index}`);
        const candidateAssetList = join(root, `candidate-${index}.list`);
        const releaseId = `2026081500000${index}-abcdef${index}`;
        const failedRevision = String(index).padStart(16, "0");
        mkdirSync(source, { recursive: true });
        mkdirSync(revisionSource, { recursive: true });
        writeFileSync(join(source, `failed-${index}.js`), `failed ${index}`);
        writeFileSync(join(revisionSource, "tile.png"), `revision ${index}`);
        writeFileSync(candidateAssetList, `failed-${index}.js\n`);
        execFileSync("bash", [
          "-c",
          'source "$1"; prepublish_immutable_dir "$2" "$3/assets" "$4"; prepublish_immutable_dir "$7" "$3/game-assets/v5/revisions/$8" "$4"; preserve_failed_prepublished_generation "$5" "$8" "$3" "$6" 3 5',
          "bash",
          staticScript,
          source,
          active,
          journal,
          candidateAssetList,
          releaseId,
          revisionSource,
          failedRevision,
        ]);
        const generationList = join(active, `.tasktopia/failed-asset-generations/${releaseId}.list`);
        if (existsSync(generationList)) utimesSync(generationList, index, index);
      }

      const retainedGenerationMetadata = readdirSync(join(active, ".tasktopia/failed-asset-generations"));
      expect(retainedGenerationMetadata.filter((name) => name.endsWith(".list"))).toHaveLength(3);
      expect(retainedGenerationMetadata.filter((name) => name.endsWith(".revision"))).toHaveLength(3);
      expect(existsSync(join(active, "assets/failed-1.js"))).toBe(false);
      expect(readFileSync(join(active, "assets/failed-4.js"), "utf8")).toBe("failed 4");
      expect(readdirSync(join(active, "game-assets/v5/revisions")).sort()).toEqual([
        "0000000000000002",
        "0000000000000003",
        "0000000000000004",
        currentRevision,
        previousRevision,
      ].sort());

      const candidate = join(root, "candidate");
      const successfulRevision = "eeeeeeeeeeeeeeee";
      mkdirSync(join(candidate, "assets"), { recursive: true });
      mkdirSync(join(candidate, `game-assets/v5/revisions/${successfulRevision}`), { recursive: true });
      writeFileSync(join(candidate, "assets/success.js"), "success");
      writeFileSync(join(candidate, `game-assets/v5/revisions/${successfulRevision}/tile.png`), "success revision");
      execFileSync("bash", ["-c", 'source "$1"; prepare_static_release_paths "$2" "$3" "$4" 5', "bash", staticScript, candidate, active, successfulRevision]);
      expect(existsSync(join(candidate, "assets/failed-1.js"))).toBe(false);
      expect(readFileSync(join(candidate, "assets/failed-2.js"), "utf8")).toBe("failed 2");
      expect(readFileSync(join(candidate, "assets/failed-4.js"), "utf8")).toBe("failed 4");
      expect(readdirSync(join(candidate, "game-assets/v5/revisions")).sort()).toEqual([
        "0000000000000002",
        "0000000000000003",
        "0000000000000004",
        currentRevision,
        successfulRevision,
      ].sort());
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("retains the complete failed bundle set when a hash already existed", () => {
    const root = mkdtempSync(join(tmpdir(), "tasktopia-failed-overlap-"));
    const active = join(root, "active");
    const source = join(root, "source");
    const journal = join(root, "journal");
    const candidateAssetList = join(root, "candidate.list");
    const releaseId = "20260815000000-abcdef0";
    const currentRevision = "aaaaaaaaaaaaaaaa";
    const staticScript = new URL("../deploy/static-release.sh", import.meta.url).pathname;

    try {
      mkdirSync(join(active, "assets"), { recursive: true });
      mkdirSync(join(active, `game-assets/v5/revisions/${currentRevision}`), { recursive: true });
      mkdirSync(join(active, "game-assets/v5"), { recursive: true });
      mkdirSync(source, { recursive: true });
      writeFileSync(join(active, "game-assets/v5/manifest.json"), JSON.stringify({ assetRevision: currentRevision }));
      writeFileSync(join(active, "assets/reused.js"), "reused");
      writeFileSync(join(source, "reused.js"), "reused");
      writeFileSync(join(source, "new.js"), "new");
      writeFileSync(candidateAssetList, "new.js\nreused.js\n");

      execFileSync("bash", [
        "-c",
        'source "$1"; prepublish_immutable_dir "$2" "$3/assets" "$4"; preserve_failed_prepublished_generation "$5" "$7" "$3" "$6" 3 5',
        "bash",
        staticScript,
        source,
        active,
        journal,
        candidateAssetList,
        releaseId,
        currentRevision,
      ]);

      const retained = readFileSync(join(active, `.tasktopia/failed-asset-generations/${releaseId}.list`), "utf8").trim().split("\n");
      expect(retained).toEqual(["assets/new.js", "assets/reused.js"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("publishes PostgreSQL only in the explicit development override", () => {
    const postgres = compose.match(/services:\n {2}postgres:\n([\s\S]*?)\n {2}app:/)?.[1];
    expect(postgres, "production postgres service").toBeDefined();
    expect(postgres).not.toContain("ports:");
    expect(developmentCompose).toContain('"127.0.0.1:${POSTGRES_PORT:-5432}:5432"');
    expect(developmentCompose).toContain("POSTGRES_PASSWORD: tasktopia");
    expect(developmentCompose).toContain("DATABASE_URL: postgres://tasktopia:tasktopia@postgres:5432/tasktopia");
    expect(developmentEnv).toContain("DATABASE_URL=postgres://tasktopia:tasktopia@127.0.0.1:5432/tasktopia");
    expect(serverConfig).toContain('process.loadEnvFile(".env")');
  });

  it("keeps local browser tests on the seeded test database", () => {
    expect(playwright).toContain("DATABASE_URL: process.env.E2E_DATABASE_URL ?? testDatabaseURL");
    expect(playwright).toContain("TEST_DATABASE_URL: testDatabaseURL");
  });

  it("runs heavy world generation after the ordinary CI gate", () => {
    expect(ci).toMatch(/worldgen:\n[\s\S]*?needs: test/);
    expect(ci).toMatch(/worldgen:[\s\S]*?npm run test:worldgen/);
  });

  it("keeps the HTTPS CDN hostname asset-only", () => {
    const storeTls = nginx.match(/# HTTPS pull-CDN origin[\s\S]*?server_name store\.tasktopia\.online;([\s\S]*?)\n\}\n\nserver \{/u)?.[1];
    expect(storeTls, "dedicated store TLS vhost").toBeDefined();
    expect(storeTls).toContain("location ~* ^/(game-assets|assets)/");
    expect(storeTls).toContain("location / {");
    expect(storeTls).toContain("return 404;");
    expect(storeTls).not.toContain("location /mcp");
    expect(storeTls).not.toContain("location /socket.io/");
  });
});
