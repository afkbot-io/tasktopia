import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const root = new URL("../", import.meta.url);
const readme = readFileSync(new URL("README.md", root), "utf8");
describe("product README", () => {
  it("links to existing documentation and a real product screenshot", () => {
    const links = [...readme.matchAll(/\]\(([^)]+)\)/g)]
      .map((m) => m[1]!)
      .filter((p) => !/^https?:/.test(p));
    expect(links.length).toBeGreaterThan(5);
    for (const path of links)
      expect(existsSync(new URL(path.split("#")[0]!, root)), path).toBe(true);
    expect(readme).toContain("screenshots/dense-city-final/city-blocks.png");
    expect(readme).toContain("docs/DEPLOYMENT.md");
    expect(readme).toContain("docs/MCP.md");
  });
  it("documents executable setup commands and separates product guidance from deployment details", () => {
    const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
    for (const match of readme.matchAll(/npm run ([\w:-]+)/g))
      expect(pkg.scripts).toHaveProperty(match[1]!);
    for (const path of [
      ".env.example",
      "deploy/.env.self-host.example",
      "docker-compose.dev.yml",
    ]) {
      expect(readme).toContain(path);
      expect(existsSync(new URL(path, root))).toBe(true);
    }
    expect(readme).not.toContain("Планета → Страна → Город");
    expect(readme).toContain("через MCP");
  });
});
