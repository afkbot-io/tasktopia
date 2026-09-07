import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("shares the updater lock and renders fail-closed maintenance", () => {
  expect(() => execFileSync("python3", [new URL("./compact_cutover_host_test.py", import.meta.url).pathname], {
    timeout: 20_000, stdio: "pipe",
  })).not.toThrow();
});
