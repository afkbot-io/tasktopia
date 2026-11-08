import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

it('releases the original65k adjacency rows while every compiled edge and route remains readable', async () => {
  const { stdout } = await promisify(execFile)(process.execPath,
    ['--expose-gc', '--import', 'tsx', 'tests/helpers/mobility-adjacency-storage-probe.ts'],
    { cwd: process.cwd(), env: { ...process.env, NODE_OPTIONS: '' }, timeout: 15_000, maxBuffer: 4096 });
  const result = JSON.parse(stdout) as { nodes: number; savedTotalBytes: number };
  expect(result.nodes).toBe(65_536);expect(result.savedTotalBytes).toBeGreaterThan(5 * 1024 * 1024);
}, 20_000);
