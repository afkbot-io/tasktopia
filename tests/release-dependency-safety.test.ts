import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);
const fromConcurrently = createRequire(require.resolve("concurrently"));
const shell = fromConcurrently("shell-quote") as { quote(tokens: Array<string | { comment: string }>): string };

it("rejects a command line terminator after a comment without breaking ordinary dev commands", () => {
  // Quote only: the potentially injected line is never handed to a shell.
  expect(() => shell.quote(["echo", "ok", { comment: "guard" }, "safe\nUNTRUSTED_COMMAND"])).toThrow(TypeError);
  const trusted = shell.quote([process.execPath, "-e", "process.stdout.write('dev-command-ok')"]);
  expect(execFileSync("sh", ["-c", trusted], { encoding: "utf8" })).toBe("dev-command-ok");
});
