import { describe, expect, it } from 'vitest';
import { TASK_FOCUS_DIM_ALPHA, TASK_SPRINT_BADGES, taskAttentionAlpha, taskSprintBadge } from '../src/client/task-focus-presentation';
import type { ChunkTaskDto } from '../src/shared/contracts';

describe('map task focus', () => {
  it('keeps matching buildings intact and strongly dims nonmatches, including a ready empty result', () => {
    const selected = new Set(['current']);
    expect(taskAttentionAlpha('current')).toBe(1);
    expect(taskAttentionAlpha('other')).toBe(1);
    expect(taskAttentionAlpha('current', selected)).toBe(1);
    expect(taskAttentionAlpha('other', selected)).toBe(TASK_FOCUS_DIM_ALPHA);
    expect(taskAttentionAlpha('current', new Set())).toBe(TASK_FOCUS_DIM_ALPHA);
    expect(TASK_FOCUS_DIM_ALPHA).toBeGreaterThan(0);
    expect(TASK_FOCUS_DIM_ALPHA).toBeLessThanOrEqual(.2);
    expect([...selected]).toEqual(['current']);
  });
});

describe('active sprint badges', () => {
  const active = new Set(['current-sprint']);
  const task = { districtId: 'current-sprint', status: 'PLANNING', workItemType: 'TASK' } satisfies Pick<ChunkTaskDto, 'districtId' | 'status' | 'workItemType'>;

  it('uses the real task status and work type only for unfinished tasks in an active district', () => {
    expect(taskSprintBadge(task, active)?.kind).toBe('PLAN');
    expect(taskSprintBadge({ ...task, status: 'STARTED' }, active)?.kind).toBe('WORK');
    expect(taskSprintBadge({ ...task, status: 'IN_PROGRESS' }, active)?.kind).toBe('WORK');
    expect(taskSprintBadge({ ...task, status: 'TESTING' }, active)?.kind).toBe('VERIFY');
    expect(taskSprintBadge({ ...task, workItemType: 'BUG' }, active)?.kind).toBe('BUG');
    expect(taskSprintBadge({ ...task, workItemType: 'HOTFIX', status: 'TESTING' }, active)?.kind).toBe('HOTFIX');
    expect(taskSprintBadge({ ...task, workItemType: 'RELEASE', status: 'IN_PROGRESS' }, active)?.kind).toBe('RELEASE');
    for (const workItemType of ['TASK', 'BUG', 'HOTFIX', 'RELEASE'] as const) {
      expect(taskSprintBadge({ ...task, workItemType, status: 'COMPLETED' }, active)).toBeUndefined();
      expect(taskSprintBadge({ ...task, workItemType, districtId: 'planned-sprint' }, active)).toBeUndefined();
      expect(taskSprintBadge({ ...task, workItemType }, new Set())).toBeUndefined();
    }
    expect([...active]).toEqual(['current-sprint']);
    expect(task).toEqual({ districtId: 'current-sprint', status: 'PLANNING', workItemType: 'TASK' });
  });

  it('reuses bounded immutable native-pixel signs for map textures and their accessible legend', () => {
    expect(taskSprintBadge(task, active)).toBe(TASK_SPRINT_BADGES.PLAN);
    expect(taskSprintBadge({ ...task, status: 'IN_PROGRESS' }, active)).toBe(TASK_SPRINT_BADGES.WORK);
    const definitions = Object.values(TASK_SPRINT_BADGES);
    expect(definitions).toHaveLength(6);
    expect(new Set(definitions.map(badge => badge.label)).size).toBe(6);
    expect(new Set(definitions.map(badge => JSON.stringify(badge.pixels))).size).toBe(6);
    for (const badge of definitions) {
      expect(badge.width).toBe(11); expect(badge.height).toBe(11);
      expect(Object.isFrozen(badge)).toBe(true);
      expect(Object.isFrozen(badge.pixels)).toBe(true);
      expect(badge.pixels.length).toBeLessThanOrEqual(badge.width * badge.height);
      expect(new Set(badge.pixels.map(pixel => `${pixel.x},${pixel.y}`)).size).toBe(badge.pixels.length);
      expect(badge.pixels.every(pixel => Number.isInteger(pixel.x) && Number.isInteger(pixel.y)
        && pixel.x >= 0 && pixel.y >= 0 && pixel.x < badge.width && pixel.y < badge.height
        && Number.isInteger(pixel.color) && pixel.color >= 0 && pixel.color <= 0xffffff)).toBe(true);
    }
  });
});
