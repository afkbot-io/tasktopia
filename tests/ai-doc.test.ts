import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const documentedTools = [
  "country.get_current",
  "country.list",
  "country.select",
  "city.list",
  "city.get",
  "city.create",
  "city.rename",
  "district.list",
  "district.create",
  "district.rename",
  "district.activate",
  "district.complete",
  "task.list",
  "task.get",
  "task.create",
  "task.rename",
  "task.set_status",
  "task.report_progress",
  "task.add_comment",
  "task.assign",
] as const;

describe("public AI integration guide", () => {
  it("documents the public endpoint, strict authentication, every tool, and every resource", async () => {
    const guide = await readFile(new URL("../public/ai.md", import.meta.url), "utf8");

    expect(guide).toContain("https://tasktopia.online/ai.md");
    expect(guide).toContain("https://tasktopia.online/mcp");
    expect(guide).toContain("Authorization: Bearer");
    expect(guide).toContain('"capacitySp": 26');
    expect(guide).not.toContain('"capacitySp": 30');
    expect(guide).toContain("isError: true");
    expect(guide).toContain("across all cities in the\nselected country");
    expect(guide).toContain("`tasktopia://country/current`");
    expect(guide).toContain("`tasktopia://catalog/buildings`");
    for (const tool of documentedTools) expect(guide).toContain(`\`${tool}\``);
  });

  it("publishes an installable progress skill with hierarchy and completion safeguards", async () => {
    const guide = await readFile(new URL("../public/ai.md", import.meta.url), "utf8");
    const skill = await readFile(new URL("../public/skills/tasktopia-progress/SKILL.md", import.meta.url), "utf8");

    expect(guide).toContain("https://tasktopia.online/skills/tasktopia-progress/SKILL.md");
    expect(guide).toContain("$tasktopia-progress");
    expect(skill).toContain("name: tasktopia-progress");
    expect(skill).toContain("Страна | Отдельный проект");
    expect(skill).toContain("Город | Долгоживущее направление");
    expect(skill).toContain("Район | Спринт");
    expect(skill).toContain("`task.report_progress`");
    expect(skill).toContain("`TESTING → IN_PROGRESS`");
    expect(skill).toContain("Готово: <конкретный результат");
    expect(skill).not.toContain("TODO");
    for (const tool of documentedTools) expect(skill).toContain(`\`${tool}\``);
  });
});
