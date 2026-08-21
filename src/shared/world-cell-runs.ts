import type { Cell, CellRunDto, RoadCellDto, RoadRunDto, SurfaceCellDto, SurfaceRunDto } from "./contracts";

type RunValue<T extends Cell> = Omit<T, "x" | "y">;

function compactRuns<T extends Cell>(cells: readonly T[], signature: (cell: T) => string): Array<{ start: Cell; end: Cell; value: RunValue<T> }> {
  const ordered = [...cells].sort((a, b) => a.y - b.y || a.x - b.x);
  const horizontal: Array<{ start: Cell; end: Cell; value: RunValue<T>; signature: string }> = [];
  for (const cell of ordered) {
    const cellSignature = signature(cell);
    const previous = horizontal.at(-1);
    if (previous && previous.signature === cellSignature && previous.end.y === cell.y && previous.end.x + 1 === cell.x) {
      previous.end = { x: cell.x, y: cell.y };
      continue;
    }
    const { x: _x, y: _y, ...value } = cell;
    void _x; void _y;
    horizontal.push({ start: { x: cell.x, y: cell.y }, end: { x: cell.x, y: cell.y }, value, signature: cellSignature });
  }

  // A second linear pass combines only horizontal singletons vertically.
  // Wide road/surface bands stay one run per row, while thin N/S segments still
  // become endpoints. This avoids the repeated cross-axis scans of the former
  // greedy algorithm during every chunk publication.
  const result = horizontal.filter((run) => run.start.x !== run.end.x);
  const columns = new Map<string, typeof horizontal>();
  for (const run of horizontal) {
    if (run.start.x !== run.end.x) continue;
    const columnKey = `${run.start.x}:${run.signature}`;
    const column = columns.get(columnKey) ?? [];
    column.push(run);
    columns.set(columnKey, column);
  }
  for (const column of columns.values()) {
    for (const run of column) {
      const previous = result.at(-1);
      if (previous && previous.start.x === previous.end.x
        && previous.signature === run.signature && previous.end.x === run.start.x && previous.end.y + 1 === run.start.y) {
        previous.end = { ...run.end };
      } else {
        result.push({ ...run, start: { ...run.start }, end: { ...run.end } });
      }
    }
  }
  return result
    .sort((left, right) => left.start.y - right.start.y || left.start.x - right.start.x)
    .map(({ start, end, value }) => ({ start, end, value }));
}

function expandRuns<T extends Cell>(runs: readonly { start: Cell; end: Cell; value: Omit<T, "x" | "y"> }[]): T[] {
  const result: T[] = [];
  for (const run of runs) {
    const dx = Math.sign(run.end.x - run.start.x);
    const dy = Math.sign(run.end.y - run.start.y);
    if (dx !== 0 && dy !== 0) throw new Error("World cell runs must be axis aligned");
    let cursor = { ...run.start };
    while (true) {
      result.push({ ...cursor, ...run.value } as T);
      if (cursor.x === run.end.x && cursor.y === run.end.y) break;
      cursor = { x: cursor.x + dx, y: cursor.y + dy };
    }
  }
  return result;
}

export function compactCellRuns(cells: readonly Cell[]): CellRunDto[] {
  return compactRuns(cells, () => "cell").map(({ start, end }) => ({ start, end }));
}

export function expandCellRuns(runs: readonly CellRunDto[]): Cell[] {
  return expandRuns<Cell>(runs.map((run) => ({ ...run, value: {} })));
}

export function compactRoadRuns(roads: readonly RoadCellDto[]): RoadRunDto[] {
  return compactRuns(roads, (road) => `${road.mask}:${road.structure}:${road.roadClass}`)
    .map(({ start, end, value }) => ({ start, end, ...value }));
}

export function expandRoadRuns(runs: readonly RoadRunDto[]): RoadCellDto[] {
  return expandRuns<RoadCellDto>(runs.map(({ start, end, ...value }) => ({ start, end, value })));
}

export function compactSurfaceRuns(surfaces: readonly SurfaceCellDto[]): SurfaceRunDto[] {
  return compactRuns(surfaces, (surface) => `${surface.kind}:${surface.finish ?? ""}`)
    .map(({ start, end, value }) => ({ start, end, ...value }));
}

export function expandSurfaceRuns(runs: readonly SurfaceRunDto[]): SurfaceCellDto[] {
  return expandRuns<SurfaceCellDto>(runs.map(({ start, end, ...value }) => ({ start, end, value })));
}
