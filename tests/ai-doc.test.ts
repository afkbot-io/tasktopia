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
});
