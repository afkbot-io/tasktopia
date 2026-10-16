import { expect, it } from 'vitest';
import { completePreparation, prepareCooperatively, stableSortPreparation } from '../src/client/cooperative-preparation';

it('sorts complete canonical keys stably without per-comparison scheduler overhead', async () => {
  const input = Array.from({ length: 32_768 }, (_, index) => ({ key: (index * 73) % 997, index }));
  const original = input.slice(), compare = (a: typeof input[number], b: typeof input[number]) => a.key - b.key;
  const expected = input.slice().sort(compare);
  let clockReads = 0, taskPosts = 0;
  const result = await prepareCooperatively(stableSortPreparation(input, compare), {
    now: () => { clockReads++; return 0; }, yieldTask: async () => { taskPosts++; },
  });
  expect(result).toEqual(expected);
  expect(input).toEqual(original);
  expect(taskPosts).toBeGreaterThan(0);
  // Scheduling checks must not grow with every merge comparison. This is a
  // deterministic work-count budget, not a host-dependent duration assertion.
  expect(clockReads).toBeLessThan(input.length * 3);
  expect(completePreparation(stableSortPreparation(input, compare))).toEqual(expected);
});

it('cancels a held canonical sort before consuming the remaining input', async () => {
  let consumed = 0, published = false;
  const controller = new AbortController(), reason = new Error('canonical sort superseded');
  const input = { *[Symbol.iterator]() { for (let index = 32_768; index > 0; index--) { consumed++; yield index; } } };
  const work = prepareCooperatively(stableSortPreparation(input, (a, b) => a - b), {
    signal: controller.signal, now: () => 0, yieldTask: async () => { controller.abort(reason); },
  }).then(result => { published = true; return result; });
  await expect(work).rejects.toBe(reason);
  expect(consumed).toBeGreaterThan(0);
  expect(consumed).toBeLessThan(32_768);
  expect(published).toBe(false);
});

it('preserves empty, short, ordered, reverse and cross-run equal-key ordering', () => {
  for (const count of [0, 1, 255, 256, 257, 1025]) for (const reverse of [false, true]) {
    const values = Array.from({ length: count }, (_, index) => ({ key: (reverse ? count - index : index) % 17, index }));
    const compare = (a: typeof values[number], b: typeof values[number]) => a.key - b.key;
    expect(completePreparation(stableSortPreparation(values, compare))).toEqual(values.slice().sort(compare));
  }
});
