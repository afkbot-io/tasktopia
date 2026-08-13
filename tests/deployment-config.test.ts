import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("production reverse proxy", () => {
  const nginx = readFileSync(new URL("../deploy/nginx-tasktopia.conf", import.meta.url), "utf8");
  const compose = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");
  const developmentCompose = readFileSync(new URL("../docker-compose.dev.yml", import.meta.url), "utf8");
  const developmentEnv = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
  const playwright = readFileSync(new URL("../playwright.config.ts", import.meta.url), "utf8");
  const serverConfig = readFileSync(new URL("../src/server/config.ts", import.meta.url), "utf8");
  const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  const dockerignore = readFileSync(new URL("../.dockerignore", import.meta.url), "utf8");
  const updateScript = readFileSync(new URL("../deploy/update-server.sh", import.meta.url), "utf8");

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
    expect(bootstrap).toContain("server_name __DOMAIN__;");
    expect(tls).toContain("/etc/letsencrypt/live/__DOMAIN__/fullchain.pem");
    expect(bootstrap).not.toContain("tasktopia.online");
    expect(tls).not.toContain("tasktopia.online");
    expect(() => execFileSync("bash", ["-n", new URL("../deploy/install-server.sh", import.meta.url).pathname])).not.toThrow();
    expect(() => execFileSync("bash", ["-n", new URL("../deploy/update-server.sh", import.meta.url).pathname])).not.toThrow();
  });

  it("uses the real browser origin and keeps the application bound to loopback by default", () => {
    expect(compose).toContain("APP_ORIGIN: ${APP_ORIGIN:-http://localhost:3000}");
    expect(compose).toContain("${APP_BIND_ADDRESS:-127.0.0.1}:${APP_PORT:-3000}:3000");
  });

  it("uses one CDN origin for the browser build and runtime policy", () => {
    expect(compose).toContain("STATIC_ORIGIN: ${STATIC_ORIGIN:-}");
    expect(compose).not.toContain("VITE_STATIC_ORIGIN:");
    expect(dockerfile).toContain("ARG STATIC_ORIGIN");
    expect(dockerfile).toContain("ENV VITE_STATIC_ORIGIN=${STATIC_ORIGIN}");
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
