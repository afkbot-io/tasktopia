import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it("bounds the live compiled route topology including typed storage on a 65k-node grid", async () => {
  const { stdout } = await promisify(execFile)(process.execPath,
    ["--expose-gc", "--import", "tsx", "tests/helpers/mobility-route-storage-probe.ts"],
    { cwd: process.cwd(), env: { ...process.env, NODE_OPTIONS: "" }, timeout: 15_000, maxBuffer: 4096 });
  const result = JSON.parse(stdout) as { nodes: number; edges: number; compiledBytes: number };
  expect(result.nodes).toBe(65_536); expect(result.edges).toBe(261_120);
  expect(result.compiledBytes).toBeLessThan(12 * 1024 * 1024);
}, 20_000);
