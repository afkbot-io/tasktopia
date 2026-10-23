import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { MapAttention } from '../src/client/components/MapAttention';
import { TASK_SPRINT_BADGES } from '../src/client/task-focus-presentation';

it('keeps the accessible legend within six color paths per sign while preserving every native pixel', () => {
  const html = renderToStaticMarkup(createElement(MapAttention, {
    countryId: 'country', cityId: 'city', userId: 'user', revision: 1, onChange: () => undefined,
  }));
  const signs = [...html.matchAll(/<svg\b[^>]*>([\s\S]*?)<\/svg>/g)].map(match => match[1]!);
  const definitions = Object.values(TASK_SPRINT_BADGES);
  expect(signs).toHaveLength(definitions.length);
  expect((html.match(/<(?:path|rect)\b/g) ?? []).length).toBeLessThanOrEqual(36);
  expect(html).toContain('Фильтры построек');
  expect(html).toContain('Значки работ');
  for (const [index, sign] of signs.entries()) {
    const badge = definitions[index]!;
    const raster = new Map<string, number>();
    const paths = [...sign.matchAll(/<path\b[^>]*>/g)];
    expect(paths.length).toBeGreaterThan(0); expect(paths.length).toBeLessThanOrEqual(6);
    for (const [element] of paths) {
      const path = element.match(/\bd="([^"]+)"/)![1]!;
      const color = Number.parseInt(element.match(/\bfill="#([0-9a-f]+)"/)![1]!, 16);
      for (const [, x, y] of path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) raster.set(`${x},${y}`, color);
    }
    expect(raster.size).toBe(badge.pixels.length);
    expect(badge.pixels.every(pixel => raster.get(`${pixel.x},${pixel.y}`) === pixel.color)).toBe(true);
    expect(html).toContain(badge.label);
  }
});
