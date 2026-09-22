/** Budgets affect optional work, never task geometry, labels or hit targets. */
export function worldDetailProfile(economy:boolean) {
  return economy
    ? {fps:30,pixelRatio:1,cars:8,walkers:12,animals:2,groundCache:24}
    : {fps:60,pixelRatio:2,cars:24,walkers:32,animals:6,groundCache:48};
}
