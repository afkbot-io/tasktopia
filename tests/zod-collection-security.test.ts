import { describe, expect, it } from 'vitest';
import { z } from 'zod';

describe('ограничение работы валидатора коллекций', () => {
  it('отклоняет слишком большой массив до чтения его элементов', () => {
    let reads = 0;
    const input = Array.from({ length: 51 }, () => ({
      get title() { reads++; return null; },
    }));
    const schema = z.array(z.object({ title: z.string() })).max(50);
    const result = schema.safeParse(input);

    expect(result.success).toBe(false);
    expect(reads).toBe(0);
    if (!result.success) expect(result.error.issues).toMatchObject([{ code: 'too_big', path: [] }]);
  });

  it('проверяет допустимые элементы и сохраняет верхнюю границу включительно', () => {
    const schema = z.array(z.object({ title: z.string() })).max(50);
    const input = Array.from({ length: 50 }, (_, index) => ({ title: String(index) }));
    expect(schema.parse(input)).toEqual(input);
    const result = schema.safeParse([{ title: null }]);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toMatchObject([{ code: 'invalid_type', path: [0, 'title'] }]);
  });
});
