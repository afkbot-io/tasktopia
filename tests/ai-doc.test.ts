import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const documentedTools = [
  "country.get_current",
  "country.list",
  "country.select",
  "country.update_profile",
  "archive.get",
  "archive.record_list",
  "archive.record_create",
  "archive.record_update",
  "archive.record_delete",
  "city.list",
  "city.get",
  "city.create",
  "city.update",
  "city.rename",
  "city.delete",
  "district.list",
  "district.create",
  "district.update",
  "district.rename",
  "district.activate",
  "district.complete",
  "district.delete",
  "task.list",
  "task.get",
  "task.create",
  "task.update_fields",
  "task.defect_create",
  "task.defect_update",
  "task.rename",
  "task.delete",
  "task.set_status",
  "task.report_progress",
  "task.add_comment",
  "task.assign",
  "task.activity",
  "task.dependency_add",
  "task.dependency_remove",
  "task.link_add",
  "task.link_remove",
  "task.attachment_add",
  "task.attachment_list",
] as const;

describe("public AI integration guide", () => {
  it("documents the public endpoint, strict authentication, every tool, and every resource", async () => {
    const guide = await readFile(new URL("../public/ai.md", import.meta.url), "utf8");

    expect(guide).toContain("https://tasktopia.online/ai.md");
    expect(guide).toContain("https://tasktopia.online/mcp");
    expect(guide).toContain("Authorization: Bearer");
    expect(guide).toContain('"capacitySp": 40');
    expect(guide).toContain("never blocks task");
    expect(guide).toContain("isError: true");
    expect(guide).toContain("systemAnalysis");
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

    expect(guide).toContain("https://tasktopia.online/skills/tasktopia-progress/SKILL.md");
    expect(guide).toContain("$tasktopia-progress");
    expect(skill).toContain("name: tasktopia-progress");
    expect(skill).toContain("Страна | Отдельный проект");
    expect(skill).toContain("Город | Долгоживущее направление");
    expect(skill).toContain("Район | Спринт");
    expect(skill).toContain("`task.report_progress`");
    expect(skill).toContain("`TESTING → IN_PROGRESS`");
    expect(skill).toContain("`OPEN → IN_PROGRESS → VERIFYING → FIXED`");
    expect(skill).toContain("родительскую задачу сохранять в\n`TESTING`");
    expect(skill).toContain("Готово: <конкретный результат");
    expect(skill).not.toContain("TODO");
    for (const tool of documentedTools) expect(skill).toContain(`\`${tool}\``);
  });
});
