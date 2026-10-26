export type MapPaddingWorkKind = "terrain-sample" | "terrain-bake" | "tree-sample" | "tree-create" | "road-bake";

const MAP_PADDING_WORK_PRIORITIES = {
  "terrain-sample": { visible: 1, background: 3 },
  "terrain-bake": { visible: 0, background: 2 },
  "tree-sample": { visible: 1, background: 5 },
  "tree-create": { visible: 1, background: 4 },
  "road-bake": { visible: 0, background: 2 },
} satisfies Record<MapPaddingWorkKind, { visible: number; background: number }>;

/** Re-evaluate visibility when draining so a moved camera can promote its work. */
export function mapPaddingWorkPriority(kind: MapPaddingWorkKind, visible: boolean): number {
  const priority = MAP_PADDING_WORK_PRIORITIES[kind];
  return visible ? priority.visible : priority.background;
}

/** Await visible work, including jobs enqueued by it, without waiting for prewarming. */
export async function waitForVisibleMapWork(
  work: ReadonlyMap<Promise<void>, string>,
  visibleKeys: () => ReadonlySet<string>,
  active: () => boolean,
  subscribeWake?: (wake: () => void) => () => void,
): Promise<void> {
  while (active()) {
    let wake!: () => void;
    const changed = new Promise<void>(resolve => { wake = resolve; });
    // Subscribe before reading the required pages, including an already ready
    // new viewport. A former visible page may now be background prewarming.
    const unsubscribe = subscribeWake?.(wake);
    try {
      const visible = visibleKeys(), pending: Promise<void>[] = [];
      for (const [job, key] of work) if (visible.has(key)) pending.push(job.catch(error => {
        if (active() && visibleKeys().has(key)) throw error;
      }));
      if (!pending.length) return;
      const settled = Promise.all(pending);
      await (subscribeWake ? Promise.race([settled, changed]) : settled);
    } finally { unsubscribe?.(); }
  }
}

export type VisibleMapPadding = {
  terrainView?: unknown;
  treeViews?: readonly unknown[];
  roads?: unknown;
  overlayView?: unknown;
  roadComplete?: boolean;
  roadFailed?: boolean;
};

/** A settled promise is not proof that its visible material was published. */
export function visibleMapPaddingReady(record: VisibleMapPadding | undefined): boolean {
  return !!record?.terrainView && !!record.treeViews && !record.roadFailed
    && (!record.roads || !!record.roadComplete && !!record.overlayView);
}
