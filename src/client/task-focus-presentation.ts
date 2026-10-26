import type { ChunkTaskDto } from '../shared/contracts';

/** An absent filter leaves the map unchanged; an empty set is an active filter. */
export const TASK_FOCUS_DIM_ALPHA = .16;

export function taskAttentionAlpha(taskId: string, matchedIds?: ReadonlySet<string>): number {
  return matchedIds === undefined || matchedIds.has(taskId) ? 1 : TASK_FOCUS_DIM_ALPHA;
}
export type TaskSprintBadgeKind = 'PLAN' | 'WORK' | 'VERIFY' | 'BUG' | 'HOTFIX' | 'RELEASE';
export type TaskSprintBadgeDefinition = {
  readonly kind: TaskSprintBadgeKind;
  readonly label: string;
  readonly width: 11;
  readonly height: 11;
  readonly pixels: ReadonlyArray<{ readonly x: number; readonly y: number; readonly color: number }>;
};

type SprintBadgeTask = Pick<ChunkTaskDto, 'districtId' | 'status' | 'workItemType'>;

// Native pixel signs share the forest/cream/brass palette of the city HUD.
// Definitions are built once so Pixi and the DOM legend reuse the same glyphs.
const COLORS: Readonly<Record<string, number>> = {
  d: 0x10251d, b: 0x365647, p: 0xf0f2e7, g: 0xd9bd78, s: 0x9ed0d3, r: 0xb75638,
};
const GLYPHS: Readonly<Record<TaskSprintBadgeKind, readonly string[]>> = {
  PLAN: [
    '......gg.', '.....gpgg', '....ggdgg', '...gpdgg.', '..ggdgg..',
    '.gpdgg...', 'ggdgg....', '.ggg.....', '..g......',
  ],
  WORK: [
    '...sssss.', '..sppsss.', '..sssss..', '....g....', '...gg....',
    '..gg.....', '.gg......', 'gg.......', '.g.......',
  ],
  VERIFY: [
    '..ppppp..', '.psssssp.', '.psssssp.', '.psssspp.', '.pspsppp.',
    '.pspppsp.', '.psspssp.', '.psssssp.', '..ppppp..',
  ],
  BUG: [
    '..r...r..', '...r.r...', '..rrrrr..', '.rprprpr.', 'r.rrrrr.r',
    '.rprprpr.', '..rrrrr..', '.r.r.r.r.', '..r...r..',
  ],
  HOTFIX: [
    '.....g...', '....gg...', '...gg.r.r', '..ggg.rrr', '.gggg..r.',
    '...g..r..', '..g..r...', '.g..r....', '...r.....',
  ],
  RELEASE: [
    '.pggggg..', '.ppppppg.', '.pgggggg.', '.pppppp..', '.p.......',
    '.p.......', '.p.......', '.p.......', '.ppp.....',
  ],
};

function defineBadge(kind: TaskSprintBadgeKind, label: string): TaskSprintBadgeDefinition {
  const pixels = new Map<number, number>();
  for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) {
    if ((x === 0 || x === 10) && (y === 0 || y === 10)) continue;
    pixels.set(y * 11 + x, COLORS[x === 0 || x === 10 || y === 0 || y === 10 ? 'b' : 'd']!);
  }
  GLYPHS[kind].forEach((row, y) => [...row].forEach((key, x) => {
    if (key !== '.') pixels.set((y + 1) * 11 + x + 1, COLORS[key]!);
  }));
  return Object.freeze({ kind, label, width: 11, height: 11,
    pixels: Object.freeze([...pixels].map(([position, color]) => Object.freeze({ x: position % 11, y: Math.floor(position / 11), color }))),
  });
}

export const TASK_SPRINT_BADGES: Readonly<Record<TaskSprintBadgeKind, TaskSprintBadgeDefinition>> = Object.freeze({
  PLAN: defineBadge('PLAN', 'Планирование'),
  WORK: defineBadge('WORK', 'Строительство'),
  VERIFY: defineBadge('VERIFY', 'Приёмка'),
  BUG: defineBadge('BUG', 'Ремонт'),
  HOTFIX: defineBadge('HOTFIX', 'Срочный ремонт'),
  RELEASE: defineBadge('RELEASE', 'Открытие'),
});

export function taskSprintBadge(task: SprintBadgeTask, activeDistrictIds: ReadonlySet<string>): TaskSprintBadgeDefinition | undefined {
  if (task.status === 'COMPLETED' || !activeDistrictIds.has(task.districtId)) return;
  switch (task.workItemType) {
    case 'BUG': return TASK_SPRINT_BADGES.BUG;
    case 'HOTFIX': return TASK_SPRINT_BADGES.HOTFIX;
    case 'RELEASE': return TASK_SPRINT_BADGES.RELEASE;
    case 'TASK':
      switch (task.status) {
        case 'PLANNING': return TASK_SPRINT_BADGES.PLAN;
        case 'STARTED': case 'IN_PROGRESS': return TASK_SPRINT_BADGES.WORK;
        case 'TESTING': return TASK_SPRINT_BADGES.VERIFY;
      }
  }
}
