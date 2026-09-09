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
