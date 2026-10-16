import { timingSafeEqual } from 'node:crypto';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import type { FastifyInstance } from 'fastify';

/** Native bounded histogram. Enabled only for an explicitly configured operator. */
export function createNodeRuntimeMetrics() {
  const delay = monitorEventLoopDelay({ resolution: 20 });
  let previous = performance.eventLoopUtilization();
  delay.enable();
  return {
    snapshot() {
      const current = performance.eventLoopUtilization();
      const utilization = performance.eventLoopUtilization(current, previous).utilization;
      previous = current;
      const memory = process.memoryUsage();
      const result = {
        eventLoopUtilization: utilization,
        eventLoopDelayMs: { samples: delay.count, p50: delay.count ? delay.percentile(50) / 1e6 : 0,
          p95: delay.count ? delay.percentile(95) / 1e6 : 0, max: delay.count ? delay.max / 1e6 : 0 },
        heapUsedBytes: memory.heapUsed, rssBytes: memory.rss,
      };
      delay.reset();
      return result;
    },
    close() { delay.disable(); },
  };
}

/** Independent operator credential; account/country/MCP credentials do not grant access. */
export function registerRuntimeObservability<T extends { role: string; uptime: number }>(
  app: FastifyInstance,
  token: string | undefined,
  collect: () => Promise<T>,
  { timeoutMs = 2_000 }: { timeoutMs?: number } = {},
): void {
  if (!token) return;
  const expected = Buffer.from(`Bearer ${token}`);
  let active: Promise<T> | undefined;
  app.get('/internal/runtime-metrics', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const authorization = request.headers.authorization;
    if (!authorization || Buffer.byteLength(authorization) !== expected.length || !timingSafeEqual(Buffer.from(authorization), expected))
      return reply.code(404).send({ error: 'NOT_FOUND' });
    if (!active) {
      const work = Promise.resolve().then(collect);
      active = work;
      void work.then(() => { if (active === work) active = undefined; }, () => { if (active === work) active = undefined; });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([active, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Runtime observation deadline')), timeoutMs);
      })]);
    } catch { return reply.code(503).send({ error: 'OBSERVATION_UNAVAILABLE' }); }
    finally { clearTimeout(timer); }
  });
}
