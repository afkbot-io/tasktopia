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
): Promise<void> {
  while (active()) {
    const visible = visibleKeys();
    const pending = [...work].filter(([, key]) => visible.has(key)).map(([job]) => job);
    if (!pending.length) return;
    await Promise.all(pending);
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
