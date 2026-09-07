import { describe, expect, it } from 'vitest';
import { acknowledgeMapInvalidations, enqueueMapInvalidation, mapInvalidationAffectsCity, mapInvalidationImpact, type MapInvalidation } from '../src/client/map-invalidation';

const status = (id: number, taskId: string, stage = 3): MapInvalidation => ({
  id, taskId, worldVersion: id + 10, type: 'task.status_changed', stage,
  status: 'IN_PROGRESS', progress: stage * 20, groundChanged: false,
});

describe('pending CITY invalidations', () => {
  it('retains updates for both tasks from one batched replay until the renderer consumes them', () => {
    const first = enqueueMapInvalidation([], status(1, 'first'));
    const second = enqueueMapInvalidation(first, status(2, 'second', 4));
    expect(second.map(event => [event.taskId, event.stage])).toEqual([['first', 3], ['second', 4]]);
    expect(first).toEqual([status(1, 'first')]);
  });
  it('compacts repeated status for one task without losing another task or a structural event', () => {
    let queue = enqueueMapInvalidation([], status(1, 'first'));
    queue = enqueueMapInvalidation(queue, { id: 2, worldVersion: 12, type: 'task.created' });
    queue = enqueueMapInvalidation(queue, status(3, 'second'));
    queue = enqueueMapInvalidation(queue, status(4, 'first', 4));
    expect(queue.map(event => event.id)).toEqual([2, 3, 4]);
    expect(acknowledgeMapInvalidations(queue, 3)).toEqual([status(4, 'first', 4)]);
  });
  it('turns overflow into an explicit authoritative resync and advances its cursor', () => {
    const queue = [status(1, 'first'), status(2, 'second')];
    const overflow = enqueueMapInvalidation(queue, status(3, 'third'), 2);
    expect(overflow).toEqual([{ id: 3, worldVersion: 13, type: 'world.resync_required', resync: true }]);
    expect(enqueueMapInvalidation(overflow, status(4, 'fourth'), 2)).toEqual([{ id: 4, worldVersion: 14, type: 'world.resync_required', resync: true }]);
  });
  it('does not confuse task details with rendered city geometry or airport changes', () => {
    expect(mapInvalidationImpact({ ...status(1, 'first'), type: 'task.comment_added' })).toBe('NONE');
    expect(mapInvalidationImpact({ ...status(1, 'first'), type: 'task.fields_updated', changedFields: ['documents'] })).toBe('NONE');
    expect(mapInvalidationImpact(status(1, 'first'))).toBe('TASK_STATUS');
    expect(mapInvalidationImpact({ ...status(1, 'first'), serviceRole: 'AIRPORT' })).toBe('SCENE');
  });
  it('refreshes remote airport route endpoints and deletions without refreshing unrelated local progress', () => {
    const event = { ...status(1, 'airport'), cityId: 'a' };
    expect(mapInvalidationAffectsCity(event, 'b')).toBe(false);
    expect(mapInvalidationAffectsCity({ ...event, serviceRole: 'AIRPORT' }, 'b')).toBe(true);
    expect(mapInvalidationAffectsCity({ ...event, type: 'task.deleted' }, 'b')).toBe(true);
    expect(mapInvalidationAffectsCity({ ...event, type: 'district.deleted' }, 'b')).toBe(true);
  });
});
