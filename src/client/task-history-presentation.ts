import type { TaskEventDto } from '../shared/contracts';

const labels: Readonly<Record<string, string>> = { title: 'Название', status: 'Этап', progress: 'Прогресс', priority: 'Приоритет',
  estimate: 'Объём', dueAt: 'Срок', workItemType: 'Тип', assignee: 'Ответственный' };
const status: Readonly<Record<string, string>> = { PLANNING: 'В плане', STARTED: 'Начато', IN_PROGRESS: 'В работе', TESTING: 'Приёмка', COMPLETED: 'Завершено' };
const priority: Readonly<Record<string, string>> = { LOW: 'Низкий', NORMAL: 'Обычный', HIGH: 'Высокий', CRITICAL: 'Критический' };
const types: Readonly<Record<string, string>> = { TASK: 'Строительство', BUG: 'Ремонт', RELEASE: 'Открытие', HOTFIX: 'Срочный ремонт' };
function value(field: string, raw: unknown): string | null {
  if (raw === null) return 'Не задано';
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  if (typeof raw === 'number' && !Number.isFinite(raw)) return null;
  const text = String(raw);
  if (field === 'status') return status[text] ?? null;
  if (field === 'priority') return priority[text] ?? null;
  if (field === 'workItemType') return types[text] ?? null;
  if (field === 'progress') return typeof raw === 'number' && raw >= 0 && raw <= 100 ? `${raw}%` : null;
  if (field === 'estimate') return typeof raw === 'number' && raw >= 0 ? `${raw} SP` : null;
  if (field === 'dueAt') return Number.isFinite(Date.parse(text)) ? new Date(text).toLocaleDateString('ru-RU') : null;
  if (field === 'assignee' && /^[a-f0-9-]{36}$/i.test(text)) return 'Назначен';
  return text.slice(0, 240);
}
export function presentTaskChanges(event: Pick<TaskEventDto, 'details'>): { label: string; before: string; after: string }[] {
  if (!Array.isArray(event.details.changes)) return [];
  return event.details.changes.slice(0, 8).flatMap(raw => {
    if (!raw || typeof raw !== 'object' || typeof raw.field !== 'string' || !labels[raw.field]) return [];
    const before = value(raw.field, raw.field === 'assignee' && typeof raw.beforeLabel === 'string' ? raw.beforeLabel.slice(0, 60) : raw.before);
    const after = value(raw.field, raw.field === 'assignee' && typeof raw.afterLabel === 'string' ? raw.afterLabel.slice(0, 60) : raw.after);
    return before === null || after === null ? [] : [{ label: labels[raw.field], before, after }];
  });
}
