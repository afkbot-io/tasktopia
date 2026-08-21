import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("moving-agent runtime asset audit", () => {
  it("keeps every gait family crisp, grounded, directional and size-stable", () => {
    const output = execFileSync(
      process.env.ASSET_PYTHON ?? "/Users/kikasnikita/Documents/Game3.0/.venv-assets/bin/python",
      ["scripts/verify-agent-animations.py"],
      { encoding: "utf8" },
    );
    expect(JSON.parse(output)).toMatchObject({ families: 42, frames: 126, valid: true });
  });
});
