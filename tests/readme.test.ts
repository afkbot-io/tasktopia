import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const manifest = JSON.parse(
  readFileSync(new URL("../assets/pixel-city-pack-v4/manifest.json", import.meta.url), "utf8"),
) as {
  buildings: Record<string, { stages: string[] }>;
  props: Record<string, unknown>;
  vehicles: Record<string, unknown>;
  terrain: Record<string, unknown>;
};

describe("open-source README", () => {
  it("keeps published catalog numbers synchronized with the runtime manifest", () => {
    const buildingCount = Object.keys(manifest.buildings).length;
    const stageCount = Object.values(manifest.buildings).reduce((sum, building) => sum + building.stages.length, 0);
    const pngCount = readdirSync(new URL("../public/game-assets/v4", import.meta.url), {
      recursive: true,
      withFileTypes: true,
    }).filter((entry) => entry.isFile() && entry.name.endsWith(".png")).length;
    const mcpSource = readFileSync(new URL("../src/server/mcp.ts", import.meta.url), "utf8");
    const toolCount = mcpSource.match(/server\.registerTool\(/g)?.length ?? 0;

    expect(readme).toContain(`| Семейства зданий | ${buildingCount} |`);
    expect(readme).toContain(`| Строительные стадии зданий | ${stageCount} |`);
    expect(readme).toContain(`| Props и городской декор | ${Object.keys(manifest.props).length} |`);
    expect(readme).toContain(`| Модели транспорта | ${Object.keys(manifest.vehicles).length} |`);
    expect(readme).toContain(`| Terrain families | ${Object.keys(manifest.terrain).length} |`);
    const formattedPngCount = pngCount.toLocaleString("ru-RU").replaceAll("\u00a0", " ");
    expect(readme).toContain(`| Все runtime PNG | ${formattedPngCount} |`);
    expect(readme).toContain(`| Зарегистрированные MCP tools | ${toolCount} |`);
  });

  it("links the reproducible showcase and every public self-hosting contract", () => {
    expect(readme).toContain("screenshots/tasktopia-showcase.png");
    expect(readme).toContain("deploy/.env.self-host.example");
    expect(readme).toContain("deploy/install-server.sh");
    expect(readme).toContain("docs/DEPLOYMENT.md");
    expect(readme).toContain("LICENSE");
    expect(readme).toContain("SECURITY.md");
    expect(readdirSync(root)).toContain("LICENSE");
  });
});
