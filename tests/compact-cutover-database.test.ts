import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("bounds backup commands and rejects changed database artifacts", () => {
  expect(() => execFileSync("python3", [new URL("./compact_cutover_database_test.py", import.meta.url).pathname], {
    timeout: 20_000, stdio: "pipe",
  })).not.toThrow();
});
