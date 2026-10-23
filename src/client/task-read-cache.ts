import type { RealtimeEvent, TaskDocumentDto } from '../shared/contracts';
import type { TaskCardDto, TaskCollection, TaskCollectionPageDto } from '../shared/task-read-contracts';
import { api } from './api';
import { OwnedReadCache } from './owned-read-cache';
import { taskEventRefreshesDependencies } from './task-read-invalidation';

const cards = new OwnedReadCache<TaskCardDto>(24, 4);
const pages = new OwnedReadCache<TaskCollectionPageDto>(18, 12, { limit: 8 * 1024 * 1024,
  weight: page => page.items.reduce((bytes, item) => bytes + JSON.stringify(item).length * 2 + 128, 256) });
const documents = new OwnedReadCache<TaskDocumentDto>(12, 4, { limit: 2 * 1024 * 1024, weight: doc => doc.content.length * 2 + 4096 });

const key = (countryId: string, taskId: string) => `${countryId}:${taskId}`;
export function peekTaskCard(countryId: string, taskId: string): TaskCardDto | undefined { return cards.peek(key(countryId, taskId)); }
export function loadTaskCard(countryId: string, taskId: string, consumerSignal?: AbortSignal): Promise<TaskCardDto> {
  return cards.read(key(countryId, taskId), async signal => {
    const card = await api<TaskCardDto>(`/api/tasks/${encodeURIComponent(taskId)}/card?${new URLSearchParams({ countryId })}`, { signal });
    if (card.kind !== 'task.card' || card.version !== 1 || card.countryId !== countryId || card.id !== taskId || !Array.isArray(card.documentMetadata) || card.documentMetadata.length > 50)
      throw new Error('Сервер вернул несовместимую карточку задачи');
    return card;
  }, consumerSignal);
}
export function loadTaskCollection<C extends TaskCollection>(countryId: string, taskId: string, collection: C, cursor: string | null = null, consumerSignal?: AbortSignal): Promise<TaskCollectionPageDto<C>> {
  const query = new URLSearchParams({ countryId, limit: '50' });
  if (cursor) query.set('cursor', cursor);
  return pages.read(`${key(countryId, taskId)}:${collection}:${cursor ?? ''}`, async signal => {
    const page = await api<TaskCollectionPageDto<C>>(`/api/tasks/${encodeURIComponent(taskId)}/collections/${collection}?${query}`, { signal });
    if (page.kind !== 'task.collection-page' || page.version !== 1 || page.countryId !== countryId || page.taskId !== taskId || page.collection !== collection
      || !Array.isArray(page.items) || page.items.length > 50 || (page.nextCursor !== null && (typeof page.nextCursor !== 'string' || page.nextCursor === cursor)))
      throw new Error('Сервер вернул несовместимую страницу задачи');
    return page;
  }, consumerSignal) as Promise<TaskCollectionPageDto<C>>;
}
export function loadTaskDocument(countryId: string, taskId: string, documentId: string, consumerSignal?: AbortSignal): Promise<TaskDocumentDto> {
  return documents.read(`${key(countryId, taskId)}:${documentId}`, async signal => {
    const doc = await api<TaskDocumentDto>(`/api/tasks/${encodeURIComponent(taskId)}/documents/${encodeURIComponent(documentId)}?${new URLSearchParams({ countryId })}`, { signal });
    if (doc.id !== documentId || doc.taskId !== taskId || typeof doc.content !== 'string' || doc.content.length > 64_000)
      throw new Error('Сервер вернул несовместимый документ задачи');
    return doc;
  }, consumerSignal);
}

export function clearTaskReadCaches(): void {
  cards.clear(); pages.clear(); documents.clear();
}

function forget(countryId: string, taskId?: string, collections?: ReadonlySet<TaskCollection>, includeDocuments = true): void {
  const prefix = taskId ? key(countryId, taskId) : `${countryId}:`;
  for (const cacheKey of cards.keys()) if (taskId ? cacheKey === prefix : cacheKey.startsWith(prefix)) cards.delete(cacheKey);
  for (const cacheKey of pages.keys()) if (cacheKey.startsWith(taskId ? `${prefix}:` : prefix)
    && (!collections || collections.has(cacheKey.split(':')[2] as TaskCollection))) pages.delete(cacheKey);
  if (includeDocuments) for (const cacheKey of documents.keys()) if (cacheKey.startsWith(taskId ? `${prefix}:` : prefix)) documents.delete(cacheKey);
}
export function forgetTaskCard(countryId: string, taskId: string): void { forget(countryId, taskId); }
export function invalidateTaskReadCaches(event: RealtimeEvent): void {
  const taskId = typeof event.payload.taskId === 'string' ? event.payload.taskId : undefined;
  if (!taskId || event.type === 'task.deleted') {
    if (event.type.startsWith('city.') || event.type.startsWith('district.') || event.type === 'country.regenerated' || event.type === 'task.deleted') forget(event.countryId);
    return;
  }
  const changed = Array.isArray(event.payload.changedFields) ? event.payload.changedFields : [];
  const affected = new Set<TaskCollection>(['events']);
  if (event.type === 'task.comment_added') affected.add('comments');
  if (event.type.startsWith('task.defect_')) affected.add('defects');
  for (const field of ['documents', 'attachments', 'mergeRequests', 'checklist', 'dependencies'] as const) if (changed.includes(field)) affected.add(field);
  if (event.type === 'task.fields_updated' && !Array.isArray(event.payload.changedFields)) {
    forget(event.countryId, taskId);
  } else forget(event.countryId, taskId, affected, affected.has('documents'));
  if (taskEventRefreshesDependencies(event)) {
    for (const cacheKey of pages.keys()) if (cacheKey.startsWith(`${event.countryId}:`) && cacheKey.split(':')[2] === 'dependencies') {
      const page = pages.peek(cacheKey);
      if (pages.hasPending(cacheKey) || page?.items.some(item => 'id' in item && item.id === taskId)) pages.delete(cacheKey);
    }
  }
}
