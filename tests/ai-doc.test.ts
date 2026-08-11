import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function registeredTools(): Promise<string[]> {
  const source = await readFile(new URL("../src/server/mcp.ts", import.meta.url), "utf8");
  return [...source.matchAll(/server\.registerTool\(\s*"([^"]+)"/g)].map((match) => match[1]);
}

describe("public AI integration guide", () => {
  it("documents the public endpoint, strict authentication, every tool, and every resource", async () => {
    const guide = await readFile(new URL("../public/ai.md", import.meta.url), "utf8");
    const documentedTools = await registeredTools();

    expect(guide).toContain("https://tasktopia.online/ai.md");
    expect(guide).toContain("https://tasktopia.online/mcp");
    expect(guide).toContain("Authorization: Bearer");
    expect(guide).toContain('"capacitySp": 40');
    expect(guide).toContain("never blocks task");
    expect(guide).toContain("isError: true");
    expect(guide).toContain("systemAnalysis");
    expect(guide).toContain("implementation-plan.md");
    expect(guide).toContain("human UI is read-only");
    expect(guide).toContain('"assigneeRole": "backend-lead"');
    expect(guide).toContain('"forUserEmail": "product-owner@example.com"');
    expect(guide).toContain("Base64 `contentBase64`");
    expect(guide).toContain("at most 50 items");
    expect(guide).toContain("reproductionSteps");
    expect(guide).toContain("OPEN → IN_PROGRESS → VERIFYING → FIXED");
    expect(guide).toContain("completion is rejected while any\nlinked defect is not `FIXED`");
    expect(guide).toContain("across all cities in the\nselected country");
    expect(guide).toContain("`tasktopia://country/current`");
    expect(guide).toContain("`tasktopia://catalog/buildings`");
    for (const tool of documentedTools) expect(guide).toContain(`\`${tool}\``);
  });

  it("publishes an installable progress skill with hierarchy and completion safeguards", async () => {
    const guide = await readFile(new URL("../public/ai.md", import.meta.url), "utf8");
    const skill = await readFile(new URL("../public/skills/tasktopia-progress/SKILL.md", import.meta.url), "utf8");
    const documentedTools = await registeredTools();

    expect(guide).toContain("https://tasktopia.online/skills/tasktopia-progress/SKILL.md");
    expect(guide).toContain("$tasktopia-progress");
    expect(skill).toContain("name: tasktopia-progress");
    expect(skill).toContain("Страна | Отдельный проект");
    expect(skill).toContain("Город | Долгоживущее направление");
    expect(skill).toContain("Район | Спринт");
    expect(skill).toContain("`task.report_progress`");
    expect(skill).toContain("`TESTING → IN_PROGRESS`");
    expect(skill).toContain("`OPEN → IN_PROGRESS → VERIFYING → FIXED`");
    expect(skill).toContain("`task.checklist_item_update`");
    expect(skill).toContain("`implementation-plan.md`");
    expect(skill).toContain("`assigneeRole`");
    expect(skill).toContain("`forUserEmail`");
    expect(skill).toContain("Прочитать устойчивый контекст");
    expect(skill).toContain("Связать commit или MR/PR");
    expect(skill).toContain("родительскую задачу сохранять в\n`TESTING`");
    expect(skill).toContain("Готово: <конкретный результат");
    expect(skill).not.toContain("TODO");
    for (const tool of documentedTools) expect(skill).toContain(`\`${tool}\``);
  });

  it("keeps the repository MCP guide aligned with the registered server tools", async () => {
    const guide = await readFile(new URL("../docs/MCP.md", import.meta.url), "utf8");
    const documentedTools = await registeredTools();

    expect(guide).toContain("`archive.record_create`");
    expect(guide).toContain("`task.checklist_replace`");
    expect(guide).toContain("`task.checklist_item_update`");
    expect(guide).toContain("`assigneeRole`");
    expect(guide).toContain("`forUserEmail`");
    expect(guide).toContain("Base64");
    for (const tool of documentedTools) expect(guide).toContain(`\`${tool}\``);
  });
});
