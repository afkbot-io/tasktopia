import { readFileSync } from "node:fs";
import { join } from "node:path";

const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { version?: unknown };

if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
  throw new Error("package.json must contain a non-empty version");
}

export const APP_VERSION = packageJson.version;
