import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("keeps the first-cutover journal fail-closed across failures and restarts", () => {
  expect(() => execFileSync("python3", [new URL("./compact_cutover_state_test.py", import.meta.url).pathname], {
    timeout: 20_000, stdio: "pipe",
  })).not.toThrow();
});
