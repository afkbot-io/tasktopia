import { expect, it } from 'vitest';
import { presentTaskChanges } from '../src/client/task-history-presentation';
it('shows actual allowed old/new values while legacy records keep their ordinary caption', () => {
  expect(presentTaskChanges({ details: { changes: [{ field: 'progress', before: 30, after: 80 }, { field: 'status', before: 'IN_PROGRESS', after: 'TESTING' }] } })).toEqual([
    { label: 'Прогресс', before: '30%', after: '80%' }, { label: 'Этап', before: 'В работе', after: 'Приёмка' },
  ]);
  expect(presentTaskChanges({ details: { status: 'COMPLETED' } })).toEqual([]);
});
it('does not display arbitrary document content, malformed values or internal assignee IDs', () => {
  expect(presentTaskChanges({ details: { changes: [{ field: 'description', before: 'private', after: 'body' }, { field: 'progress', before: Infinity, after: -1 },
    { field: 'assignee', before: null, after: '12345678-1234-1234-1234-123456789abc' }, { field: 'title', before: 'a', after: { secret: true } }] } })).toEqual([
    { label: 'Ответственный', before: 'Не задано', after: 'Назначен' },
  ]);
});
