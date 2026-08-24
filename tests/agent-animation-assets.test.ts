import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("moving-agent runtime asset audit", () => {
  it("keeps every gait family crisp, grounded, directional and size-stable", () => {
    const output = execFileSync(
      process.env.ASSET_PYTHON ?? resolve(".venv-assets/bin/python"),
      ["scripts/verify-agent-animations.py"],
      { encoding: "utf8" },
    );
    expect(JSON.parse(output)).toMatchObject({ families: 42, frames: 126, valid: true });
  });
});
