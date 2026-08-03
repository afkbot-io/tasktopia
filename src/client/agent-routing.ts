import type { Cell } from "../shared/contracts";

export function agentCellKey(cell: Cell): string { return `${cell.x},${cell.y}`; }

export function connectShortWalkGaps(base: Map<string, Cell>, availableGround: Map<string, Cell>, maxGapCells = 2): Map<string, Cell> {
  const connected = new Map(base);
  const directions = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
  for (const origin of base.values()) {
    for (const direction of directions) {
      for (let gap = 1; gap <= maxGapCells; gap += 1) {
        const target = { x: origin.x + direction.x * (gap + 1), y: origin.y + direction.y * (gap + 1) };
        if (!base.has(agentCellKey(target))) continue;
        const intermediate: Cell[] = [];
        for (let step = 1; step <= gap; step += 1) intermediate.push({ x: origin.x + direction.x * step, y: origin.y + direction.y * step });
        if (intermediate.every((cell) => availableGround.has(agentCellKey(cell)))) {
          for (const cell of intermediate) connected.set(agentCellKey(cell), availableGround.get(agentCellKey(cell))!);
        }
        break;
      }
    }
  }
  return connected;
}

export function mustYieldAtCrosswalk(next: Cell, crosswalks: Set<string>, walkers: ReadonlyArray<{ current: Cell; next: Cell }>): boolean {
  const nextKey = agentCellKey(next);
  if (!crosswalks.has(nextKey)) return false;
  return walkers.some((walker) => agentCellKey(walker.current) === nextKey || agentCellKey(walker.next) === nextKey);
}
