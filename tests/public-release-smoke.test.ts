import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, expect, it } from 'vitest';

const execute = promisify(execFile);
const script = new URL('../deploy/public-release-smoke.py', import.meta.url).pathname;
const revision = '1234567890abcdef';
let root: string, origin: string;
let server: ReturnType<typeof createServer>;
let bodies: Map<string, Buffer>;
let failPath = '', hangingPath = '', tricklePath = '';
let requests: string[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tasktopia-public-smoke-'));
  await mkdir(join(root, 'assets'));
  await mkdir(join(root, 'game-assets/v5'), { recursive: true });
  failPath = ''; hangingPath = ''; tricklePath = ''; requests = [];
  server = createServer((request, reply) => {
    const path = new URL(request.url!, origin).pathname;
    requests.push(path);
    if (path === hangingPath) return;
    if (path === failPath) { reply.writeHead(504); reply.end('Gateway timeout'); return; }
    const body = bodies.get(path);
    if (!body) { reply.writeHead(404); reply.end('Missing'); return; }
    if (path === tricklePath) {
      let position = 0;
      reply.writeHead(200);
      const timer = setInterval(() => {
        reply.write(body.subarray(position, ++position));
        if (position >= body.length) { clearInterval(timer); reply.end(); }
      }, 40);
      reply.on('close', () => clearInterval(timer));
      return;
    }
    reply.end(body);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const html = '<html><script type="module" src="/assets/index-abcdefgh.js"></script><link rel="stylesheet" href="/assets/index-abcdefgh.css"></html>';
  const manifest = JSON.stringify({ assetRevision: revision, terrain: { GRASS: ['terrain/grass.png'] }, buildings: { school: { stages: ['buildings/school/stage-5.png'] } } });
  bodies = new Map([
    ['/', Buffer.from(html)], ['/assets/index-abcdefgh.js', Buffer.from('export const ready=true;')],
    ['/assets/index-abcdefgh.css', Buffer.from('body{color:green}')],
    [`/game-assets/v5/revisions/${revision}/manifest.json`, Buffer.from(manifest)],
    [`/game-assets/v5/revisions/${revision}/terrain/grass.png`, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1])],
    [`/game-assets/v5/revisions/${revision}/buildings/school/stage-5.png`, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 2])],
  ]);
  await writeFile(join(root, 'index.html'), html);
  for (const [path, body] of bodies) {
    if (path === '/') continue;
    const local = path.startsWith('/game-assets/') ? path.replace(`/revisions/${revision}`, '') : path;
    await mkdir(join(root, local, '..'), { recursive: true });
    await writeFile(join(root, local), body);
    if (path.startsWith('/game-assets/')) {
      await mkdir(join(root, path, '..'), { recursive: true });
      await writeFile(join(root, path), body);
    }
  }
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
});
const smoke = (extra: string[] = []) => execute(process.env.PYTHON3_BIN ?? 'python3', [script, '--origin', origin, '--public-root', root, '--asset-revision', revision, ...extra], { timeout: 5_000 });

it('checks the exact entry, compiled modules, manifest and representative versioned PNG bytes', async () => {
  const result = JSON.parse((await smoke()).stdout);
  expect(result.status).toBe('ok');
  expect(result.checked).toBe(6);
  expect(requests).toContain(`/game-assets/v5/revisions/${revision}/buildings/school/stage-5.png`);
});

it('ignores actual source-art provenance while checking each published runtime sprite', async () => {
  const actual = JSON.parse(await readFile(new URL('../public/game-assets/v5/manifest.json', import.meta.url), 'utf8'));
  const prop = actual.props['city-event-child-west'];
  const ambient = actual.microAmbient.sprites['micro-car-blue-north'];
  const transport = actual.cityTransport.sprites['ferry-south'];
  const manifest = JSON.stringify({
    ...JSON.parse(bodies.get(`/game-assets/v5/revisions/${revision}/manifest.json`)!.toString()),
    props: { child: prop },
    microAmbient: { sources: actual.microAmbient.sources, sprites: { car: ambient } },
    cityTransport: { sprites: { ferry: transport } },
  });
  bodies.set(`/game-assets/v5/revisions/${revision}/manifest.json`, Buffer.from(manifest));
  for (const [path, body] of [
    ['manifest.json', Buffer.from(manifest)],
    ...[prop.path, ambient.path, transport.path].map(path => [path, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 3])] as const),
  ] as const) {
    const url = `/game-assets/v5/revisions/${revision}/${path}`;
    bodies.set(url, body);
    for (const local of [`game-assets/v5/${path}`, url]) {
      await mkdir(join(root, local, '..'), { recursive: true });
      await writeFile(join(root, local), body);
    }
  }
  const result = JSON.parse((await smoke()).stdout);
  expect(result.checked).toBe(9);
  for (const path of [prop.path, ambient.path, transport.path]) {
    expect(requests).toContain(`/game-assets/v5/revisions/${revision}/${path}`);
  }
  expect(requests.some(path => path.includes('ai-authored'))).toBe(false);
});

it('rejects a missing versioned runtime sprite even when its unversioned copy exists', async () => {
  await rm(join(root, `game-assets/v5/revisions/${revision}/terrain/grass.png`));
  await expect(smoke()).rejects.toThrow();
});

it('fails when public JS returns 504 despite a healthy application', async () => {
  failPath = '/assets/index-abcdefgh.js';
  await expect(smoke()).rejects.toThrow();
});

it('rejects an old public entry and a corrupt asset with HTTP200', async () => {
  bodies.set('/', Buffer.from('<html>Old release</html>'));
  await expect(smoke()).rejects.toThrow();
  bodies.set('/', await import('node:fs/promises').then(fs => fs.readFile(join(root, 'index.html'))));
  bodies.set(`/game-assets/v5/revisions/${revision}/terrain/grass.png`, Buffer.from('Wrong cached object'));
  await expect(smoke()).rejects.toThrow();
});

it('bounds a hung public asset request', async () => {
  hangingPath = '/assets/index-abcdefgh.js';
  const start = performance.now();
  await expect(smoke(['--timeout', '0.1', '--deadline', '0.5'])).rejects.toThrow();
  expect(performance.now() - start).toBeLessThan(2_000);
});

it('checks the CDN actually referenced by the candidate and rejects its gateway failure', async () => {
  const cdn = createServer((request, reply) => {
    const path = new URL(request.url!, origin).pathname;
    if (path.endsWith('.js')) { reply.writeHead(504); reply.end('CDN outage'); return; }
    reply.setHeader('Access-Control-Allow-Origin', origin);
    reply.end(bodies.get(path));
  });
  await new Promise<void>(resolve => cdn.listen(0, '127.0.0.1', resolve));
  const cdnOrigin = `http://127.0.0.1:${(cdn.address() as { port: number }).port}`;
  try {
    const html = `<html><script type="module" src="${cdnOrigin}/assets/index-abcdefgh.js"></script><link rel="stylesheet" href="${cdnOrigin}/assets/index-abcdefgh.css"></html>`;
    await writeFile(join(root, 'index.html'), html); bodies.set('/', Buffer.from(html));
    await expect(smoke()).rejects.toMatchObject({ stderr: expect.stringContaining('HTTP Error 504') });
  } finally { cdn.closeAllConnections(); await new Promise<void>(resolve => cdn.close(() => resolve())); }
});

it('enforces the overall deadline when an asset keeps delivering small chunks', async () => {
  tricklePath = '/assets/index-abcdefgh.js';
  const start = performance.now();
  await expect(smoke(['--timeout', '0.1', '--deadline', '0.12'])).rejects.toThrow();
  expect(performance.now() - start).toBeLessThan(500);
});
