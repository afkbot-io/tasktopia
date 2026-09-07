import type { Cell, CellRunDto, Rect } from "../../shared/contracts";
import { compactCellRuns } from "../../shared/world-cell-runs";
import { cellKey, contains, rectangleFootprint } from "./grid";

type OccupiedGeometry = { footprint: readonly Cell[]; accessPath: readonly Cell[] };
type ReservedSite = { origin: Cell; width: number; height: number };

/** Hard occupancy only. Paving travels separately in surfaceHaloRuns. */
export function buildDecorationHardHalo(input: {
  chunkBounds: Rect;
  surfaceScope: Rect;
  roads: readonly Cell[];
  tasks: readonly OccupiedGeometry[];
  features: readonly OccupiedGeometry[];
  reservedSites: readonly ReservedSite[];
}): CellRunDto[] {
  const { chunkBounds, surfaceScope } = input;
  // Roads/tasks/features already carry their intersecting geometry in the
  // local DTO. Planned-site entities, however, are emitted only by origin
  // chunk: their reserved mask must also cover this chunk's interior.
  const outsideGeometry = [
    ...input.roads,
    ...input.tasks.flatMap(task => [...task.footprint, ...task.accessPath]),
    ...input.features.flatMap(feature => [...feature.footprint, ...feature.accessPath]),
  ].filter(cell => !contains(chunkBounds, cell) && contains(surfaceScope, cell));
  const cells = new Map([
    ...outsideGeometry,
    ...input.reservedSites.flatMap(site => {
      // Clip before expansion to the chunk plus four-cell halo. Never expand
      // every reserved plot in a large sprint for each scene page.
      const minX = Math.max(site.origin.x, surfaceScope.minX);
      const minY = Math.max(site.origin.y, surfaceScope.minY);
      const maxX = Math.min(site.origin.x + site.width - 1, surfaceScope.maxX);
      const maxY = Math.min(site.origin.y + site.height - 1, surfaceScope.maxY);
      return minX > maxX || minY > maxY ? []
        : rectangleFootprint({ x: minX, y: minY }, maxX - minX + 1, maxY - minY + 1);
    }),
  ].map(cell => [cellKey(cell), { x: cell.x, y: cell.y }]));
  return compactCellRuns([...cells.values()]);
}
