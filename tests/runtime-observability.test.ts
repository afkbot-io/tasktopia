import Fastify from 'fastify';
import { afterEach, expect, it, vi } from 'vitest';
import { registerRuntimeObservability } from '../src/server/runtime-observability';

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); });
const token = 'a'.repeat(64);

it.each([undefined, '', 'wrong', `Bearer ${token}extra`, `Bearer ${'é'.repeat(64)}`])('does not expose operator metrics without the exact configured bearer (%s)', async authorization => {
  const app = Fastify(), collect = vi.fn(async () => ({ role: 'web', uptime: 1 })); apps.push(app);
  registerRuntimeObservability(app, token, collect);
  const response = await app.inject({ url: '/internal/runtime-metrics', headers: authorization ? { authorization } : {} });
  expect(response.statusCode).toBe(404); expect(collect).not.toHaveBeenCalled();
});

it('stays disabled without an operator token, even for an authenticated browser session', async () => {
  const app = Fastify(), collect = vi.fn(async () => ({ role: 'web', uptime: 1 })); apps.push(app);
  registerRuntimeObservability(app, undefined, collect);
  const response = await app.inject({ url: '/internal/runtime-metrics', headers: { authorization: `Bearer ${token}`, cookie: 'session=owner' } });
  expect(response.statusCode).toBe(404); expect(collect).not.toHaveBeenCalled();
});

it('returns a private no-store snapshot and shares simultaneous collection work', async () => {
  const app = Fastify(); apps.push(app);
  let resolve!: (value: { role: string; uptime: number }) => void;
  const collect = vi.fn(() => new Promise<{ role: string; uptime: number }>(done => { resolve = done; }));
  registerRuntimeObservability(app, token, collect);
  const request = () => app.inject({ url: '/internal/runtime-metrics', headers: { authorization: `Bearer ${token}` } });
  const first = request(), second = request();
  await vi.waitFor(() => expect(collect).toHaveBeenCalledTimes(1));
  resolve({ role: 'world', uptime: 20 });
  for (const response of await Promise.all([first, second])) {
    expect(response.statusCode).toBe(200); expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({ role: 'world', uptime: 20 });
    expect(response.body).not.toContain(token);
  }
});

it('bounds a hung collection and does not start overlapping replacement SQL', async () => {
  const app = Fastify(); apps.push(app);
  const collect = vi.fn(() => new Promise<{ role: string; uptime: number }>(() => undefined));
  registerRuntimeObservability(app, token, collect, { timeoutMs: 10 });
  for (let n = 0; n < 2; n++) {
    const response = await app.inject({ url: '/internal/runtime-metrics', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(503); expect(response.body).not.toContain(token);
  }
  expect(collect).toHaveBeenCalledTimes(1);
});
