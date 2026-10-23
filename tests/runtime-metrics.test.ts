import { expect, it, vi } from 'vitest';
import { QueryMetrics } from '../src/server/runtime-metrics';

it('counts in-flight and rejected SQL calls while keeping query text and values private', async () => {
  const metrics = new QueryMetrics(3);
  let resolve!: () => void;
  const pending = metrics.measure(() => new Promise<void>(done => { resolve = done; }));
  expect(metrics.snapshot()).toMatchObject({ started: 1, completed: 0, failed: 0, inFlight: 1 });
  resolve(); await pending;
  await expect(metrics.measure(async () => { throw new Error('Private SQL value'); })).rejects.toThrow('Private SQL value');
  expect(metrics.snapshot()).toMatchObject({ started: 2, completed: 2, failed: 1, inFlight: 0 });
  expect(JSON.stringify(metrics.snapshot())).not.toContain('Private SQL value');
});

it('records a bounded recent latency distribution including awaited pool/service time', async () => {
  const metrics = new QueryMetrics(3);
  const now = vi.spyOn(performance, 'now');
  try {
    for (const ms of [1, 2, 3, 40]) {
      now.mockReturnValueOnce(0).mockReturnValueOnce(ms);
      await metrics.measure(async () => 'ok');
    }
    const result = metrics.snapshot();
    expect(result.completed).toBe(4);
    expect(result.latencyMs).toEqual({ samples: 3, p50: 3, p95: 40, max: 40 });
  } finally { now.mockRestore(); }
});
