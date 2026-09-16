import type { Cell } from "../shared/contracts";
export type MapDependencySelection = { sourceId: string; targetIds: string[] };
export function dependencySegments(selection: MapDependencySelection | undefined, tasks: ReadonlyMap<string, { footprint: Cell[] }>) {
  if (!selection) return [];
  const center = (id: string) => {
    const cells = tasks.get(id)?.footprint;
    if (!cells?.length) return null;
    return { x: cells.reduce((n,c) => n+c.x+.5,0)/cells.length, y: cells.reduce((n,c) => n+c.y+.5,0)/cells.length };
  };
  const source = center(selection.sourceId);
  if (!source) return [];
  return [...new Set(selection.targetIds)].filter(id => id !== selection.sourceId).flatMap(id => {
    const target = center(id);
    return target ? [{ id, source, target }] : [];
  });
}
