import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("preserves files, task content and every country across the cutover boundaries", () => {
  for (const name of ["files", "conservation", "driver"]) {
    expect(() => execFileSync("python3", [`tests/compact_cutover_${name}_test.py`], {
      timeout: 30_000, stdio: "pipe",
    })).not.toThrow();
  }
});
