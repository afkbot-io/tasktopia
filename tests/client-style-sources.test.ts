import { readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { expect, test } from "vitest";

test("release CSS scans only the client and HTML entry, independent of local docs and tools", async () => {
  const repository = resolve(import.meta.dirname, "..");
  const stylesheet = resolve(repository, "src/client/styles.css");
  const client = dirname(stylesheet);
  const entry = resolve(repository, "index.html");
  const compiler = await compile(await readFile(stylesheet, "utf8"), {
    base: client,
    onDependency: () => {},
  });

  // Tailwind's Vite adapter falls back to the whole repository for a null root.
  // That lets local documentation change emitted CSS and every dependent hash.
  expect(compiler.root).not.toBeNull();
  expect(compiler.root).not.toBe("none");
  if (!compiler.root || compiler.root === "none") throw new Error("Explicit client source required");
  expect(resolve(compiler.root.base, compiler.root.pattern)).toBe(client);
  expect(compiler.sources.map(source => resolve(source.base, source.pattern))).toEqual([entry]);

  const scanner = new Scanner({ sources: [
    { ...compiler.root, negated: false },
    ...compiler.sources,
  ] });
  const candidates = scanner.scan();
  expect(scanner.files).toContain(entry);
  expect(scanner.files.some(file => file.endsWith(`${sep}App.tsx`))).toBe(true);
  expect(scanner.files.filter(file => file !== entry && !file.startsWith(`${client}${sep}`))).toEqual([]);
  expect(candidates).toContain("hidden");
  expect(compiler.build(candidates)).toContain(".hidden");
});
