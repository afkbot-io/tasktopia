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
