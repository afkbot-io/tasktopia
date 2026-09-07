import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("loads the building catalog with the Node ESM loader used during browser test collection", () => {
  const url = new URL("../src/shared/catalog.ts", import.meta.url).href;
  // A fresh Node process deliberately bypasses the Vite/Vitest JSON transform.
  const output = execFileSync(process.execPath, ["--input-type=module", "--eval", `
    const { ASSET_REVISION, getBuilding } = await import(${JSON.stringify(url)});
    console.log(JSON.stringify({ revision: ASSET_REVISION,
      stages: getBuilding("compact-apartment-v1").stages.length }));
  `], { encoding: "utf8", timeout: 10_000 });
  expect(JSON.parse(output)).toEqual({ revision: expect.stringMatching(/^[a-f0-9]{16}$/), stages: 5 });
});
