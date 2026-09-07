export type PaddingRetryState = {
  terrainFailed?: boolean; treeFailed?: boolean; roadFailed?: boolean;
  terrainPending?: boolean; treePending?: boolean; roadPending?: boolean;
  treeComplete?: boolean; roadComplete?: boolean;
};

/** Explicit user retry only; replacement identity fences unfinished old work. */
export function retryFailedPadding<T extends PaddingRetryState>(records: Map<string, T>): number {
  let reset = 0;
  for (const [id, record] of records) {
    if (!record.terrainFailed && !record.treeFailed && !record.roadFailed) continue;
    records.set(id, { ...record,
      terrainFailed: false, treeFailed: false, roadFailed: false,
      terrainPending: false, treePending: false, roadPending: false,
      treeComplete: record.treeFailed ? false : record.treeComplete,
      roadComplete: record.roadFailed ? false : record.roadComplete,
    });
    reset++;
  }
  return reset;
}
